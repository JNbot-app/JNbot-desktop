#include "encoder.h"
#include "llama.h"
#include "ggml-backend.h"
#include "logging.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

struct eg_handle {
    llama_model * model = nullptr;
    llama_context * context = nullptr;
    int32_t limit = 0;
    std::string backend;
    std::mutex mutex;
    float * destination = nullptr;
    size_t expected = 0;
    bool captured = false;
    std::string capture_error;
    ~eg_handle() {
        if (context) llama_free(context);
        if (model) llama_model_free(model);
    }
};

static void error_message(char * dst, size_t size, const std::string & message) {
    if (dst && size) std::snprintf(dst, size, "%s", message.c_str());
}

static bool capture(ggml_tensor * tensor, bool ask, void * data) {
    auto & h = *static_cast<eg_handle *>(data);
    if (std::strcmp(ggml_get_name(tensor), "result_norm") != 0) return ask ? false : true;
    if (ask) return h.destination != nullptr;
    try {
        if (tensor->type != GGML_TYPE_F32 || !ggml_is_contiguous(tensor)
            || tensor->ne[0] != 512 || size_t(ggml_nelements(tensor)) != h.expected) {
            throw std::runtime_error("Expected contiguous FP32 [tokens,512] result_norm features");
        }
        ggml_backend_tensor_get(tensor, h.destination, 0, h.expected * sizeof(float));
        for (size_t i = 0; i < h.expected; ++i) {
            if (!std::isfinite(h.destination[i])) throw std::runtime_error("Non-finite token features");
        }
        h.captured = true;
        return true;
    } catch (const std::exception & e) {
        h.capture_error = e.what();
        return false;
    }
}

static std::vector<llama_token> tokenize(eg_handle & h, const char * text) {
    if (!text) throw std::invalid_argument("Missing UTF-8 text");
    const size_t bytes = std::strlen(text);
    if (bytes > 1024 * 1024) throw std::invalid_argument("Text exceeds encoder byte limit");
    const auto * vocab = llama_model_get_vocab(h.model);
    int32_t count = llama_tokenize(vocab, text, int32_t(bytes), nullptr, 0, true, false);
    if (count == INT32_MIN) throw std::runtime_error("Tokenizer overflow");
    count = count < 0 ? -count : count;
    if (count < 1 || count > h.limit) throw std::invalid_argument("Encoder context limit exceeded");
    std::vector<llama_token> tokens(count);
    if (llama_tokenize(vocab, text, int32_t(bytes), tokens.data(), count, true, false) != count)
        throw std::runtime_error("Tokenizer length changed");
    return tokens;
}

eg_handle * eg_load(const char * path, uint64_t offset, int32_t limit, int32_t threads,
                    const char * requested, char * error, size_t error_size) {
    try {
        if (!path || !requested || limit < 1 || limit > 8192 || threads < 1)
            throw std::invalid_argument("Invalid encoder options; context must be 1..8192");
        if (offset > uint64_t(INT64_MAX) || offset % 64)
            throw std::invalid_argument("GGUF offset must be nonnegative and 64-byte aligned");
        static std::once_flag initialized;
        std::call_once(initialized, [] {
            llama_log_set(eg_log, nullptr);
            llama_backend_init();
        });
        const std::string name(requested);
        if (name != "auto" && name != "cpu" && name != "metal" && name != "cuda" && name != "vulkan")
            throw std::invalid_argument("Unknown encoder backend");
        ggml_backend_dev_t chosen = nullptr;
        std::string selected = "cpu";
        if (name != "cpu") {
            for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
                auto dev = ggml_backend_dev_get(i);
                auto type = ggml_backend_dev_type(dev);
                if (type != GGML_BACKEND_DEVICE_TYPE_GPU && type != GGML_BACKEND_DEVICE_TYPE_IGPU) continue;
                std::string reg = ggml_backend_reg_name(ggml_backend_dev_backend_reg(dev));
                std::transform(reg.begin(), reg.end(), reg.begin(), [](unsigned char c) { return char(std::tolower(c)); });
                if (reg == "mtl") reg = "metal";
                if ((name == "auto" && (reg == "metal" || reg == "cuda" || reg == "vulkan")) || name == reg) {
                    chosen = dev; selected = reg; break;
                }
            }
            if (!chosen && name != "auto") throw std::runtime_error("Requested GPU backend is unavailable");
        }
        auto h = std::make_unique<eg_handle>();
        h->backend = selected;
        h->limit = limit;
        auto mp = llama_model_default_params();
        ggml_backend_dev_t devices[] = {chosen, nullptr};
        mp.devices = devices;
        mp.n_gpu_layers = chosen ? -1 : 0;
        mp.load_mode = LLAMA_LOAD_MODE_MMAP;
#ifdef _WIN32
        FILE * file = _wfopen(std::filesystem::u8path(path).c_str(), L"rb");
#else
        FILE * file = std::fopen(path, "rb");
#endif
        if (!file) throw std::runtime_error("Cannot open GGUF file");
        std::unique_ptr<FILE, decltype(&std::fclose)> owner(file, &std::fclose);
#ifdef _WIN32
        if (_fseeki64(file, static_cast<__int64>(offset), SEEK_SET))
#else
        if (offset > uint64_t(INT64_MAX) || fseeko(file, static_cast<off_t>(offset), SEEK_SET))
#endif
            throw std::runtime_error("Cannot seek to GGUF section");
        h->model = llama_model_load_from_file_ptr(file, mp);
        if (!h->model) throw std::runtime_error("Failed to load GGUF model");
        char architecture[64] = {};
        llama_model_meta_val_str(h->model, "general.architecture", architecture, sizeof(architecture));
        if (std::strcmp(architecture, "gemma-embedding2") != 0 || llama_model_n_embd(h->model) != 512
            || llama_model_n_embd_out(h->model) != 768)
            throw std::runtime_error("Expected text-only EmbeddingGemma 2, with 512 hidden and 768 output dimensions");
        auto cp = llama_context_default_params();
        cp.n_ctx = limit; cp.n_batch = limit; cp.n_ubatch = limit;
        cp.n_seq_max = 1; cp.n_threads = threads; cp.n_threads_batch = threads;
        cp.embeddings = true;
        cp.pooling_type = LLAMA_POOLING_TYPE_MEAN;
        cp.attention_type = LLAMA_ATTENTION_TYPE_NON_CAUSAL;
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
        cp.cb_eval = capture; cp.cb_eval_user_data = h.get();
        cp.type_k = GGML_TYPE_F32; cp.type_v = GGML_TYPE_F32;
        cp.offload_kqv = chosen != nullptr; cp.op_offload = chosen != nullptr;
        h->context = llama_init_from_model(h->model, cp);
        if (!h->context) throw std::runtime_error("Failed to initialize encoder context");
        return h.release();
    } catch (const std::exception & e) { error_message(error, error_size, e.what()); return nullptr; }
}

int32_t eg_token_count(eg_handle * h, const char * text, char * error, size_t error_size) {
    try {
        if (!h) throw std::invalid_argument("Null encoder handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        return int32_t(tokenize(*h, text).size());
    } catch (const std::exception & e) { error_message(error, error_size, e.what()); return -1; }
}

int32_t eg_encode(eg_handle * h, const char * text, float * features, size_t capacity,
                  float * pooled, size_t pooled_capacity, char * error, size_t error_size) {
    try {
        if (!h) throw std::invalid_argument("Null encoder handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        auto tokens = tokenize(*h, text);
        if (!features || capacity < tokens.size() * 512 || !pooled || pooled_capacity < 768)
            throw std::invalid_argument("Insufficient encoder output capacity");
        h->destination = features; h->expected = tokens.size() * 512;
        h->captured = false; h->capture_error.clear();
        struct ClearCapture { eg_handle * h; ~ClearCapture() { h->destination = nullptr; } } clear{h};
        if (auto memory = llama_get_memory(h->context)) llama_memory_clear(memory, true);
        auto batch = llama_batch_init(int32_t(tokens.size()), 0, 1);
        struct FreeBatch { llama_batch & batch; ~FreeBatch() { llama_batch_free(batch); } } free_batch{batch};
        batch.n_tokens = int32_t(tokens.size());
        for (int32_t i = 0; i < batch.n_tokens; ++i) {
            batch.token[i] = tokens[i]; batch.pos[i] = i;
            batch.n_seq_id[i] = 1; batch.seq_id[i][0] = 0; batch.logits[i] = true;
        }
        const int result = llama_encode(h->context, batch);
        if (!h->capture_error.empty()) throw std::runtime_error(h->capture_error);
        if (result != 0) throw std::runtime_error("Encoder encode failed: " + std::to_string(result));
        if (!h->captured) throw std::runtime_error("Pinned result_norm feature capture was not executed");
        const float * embedding = llama_get_embeddings_seq(h->context, 0);
        if (!embedding) throw std::runtime_error("Encoder did not return a pooled embedding");
        double norm = 0;
        for (int i = 0; i < 768; ++i) {
            if (!std::isfinite(embedding[i])) throw std::runtime_error("Non-finite pooled embedding");
            norm += double(embedding[i]) * embedding[i];
        }
        if (!(norm > 0)) throw std::runtime_error("Zero pooled embedding");
        norm = std::sqrt(norm);
        for (int i = 0; i < 768; ++i) pooled[i] = float(embedding[i] / norm);
        return int32_t(tokens.size());
    } catch (const std::exception & e) { error_message(error, error_size, e.what()); return -1; }
}
const char * eg_backend(const eg_handle * h) { return h ? h->backend.c_str() : "unloaded"; }
const char * eg_revision() { return LLAMA_PIN; }
const char * eg_source_sha256() { return EG_SOURCE_SHA256; }
void eg_free(eg_handle * h) { delete h; }
