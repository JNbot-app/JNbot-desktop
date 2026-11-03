#include <node_api.h>
#include <cmath>
#include <climits>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifndef JNBOT_NEEDLE_UNSUPPORTED
#include "vendor/decoder/needle.h"
#include "vendor/encoder/encoder.h"
#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#else
#include <cblas.h>
#endif
#endif

namespace {
void check(napi_status result) {
  if (result != napi_ok) throw std::runtime_error("Invalid native argument");
}
std::string text(napi_env env, napi_value value) {
  size_t count;
  check(napi_get_value_string_utf8(env, value, nullptr, 0, &count));
  std::vector<char> buffer(count + 1);
  check(napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &count));
  std::string result(buffer.data(), count);
  if (result.find('\0') != std::string::npos) throw std::runtime_error("Input contains NUL");
  return result;
}
uint64_t integer(napi_env env, napi_value value) {
  double result;
  check(napi_get_value_double(env, value, &result));
  if (!std::isfinite(result) || result < 0 || result > 9007199254740991. || result != std::floor(result))
    throw std::runtime_error("Expected a nonnegative safe integer");
  return uint64_t(result);
}
template<class T> T *array(napi_env env, napi_value value, napi_typedarray_type expected, size_t &size) {
  napi_typedarray_type type;
  napi_value buffer;
  size_t offset;
  void *data;
  check(napi_get_typedarray_info(env, value, &type, &size, &data, &buffer, &offset));
  if (type != expected) throw std::runtime_error("Invalid native array type");
  return static_cast<T *>(data);
}
#ifndef JNBOT_NEEDLE_UNSUPPORTED
struct PendingEncoding {
  std::vector<float> features, pooled;
  int tokens;
};
struct State {
  std::unique_ptr<PendingEncoding> pending;
  np_handle *decoder = nullptr;
  eg_handle *encoder = nullptr;
  void close() { pending.reset(); eg_free(encoder); encoder = nullptr; np_free(decoder); decoder = nullptr; }
  ~State() { close(); }
};
void engine_check(int result, const char *error) {
  if (result < 0) throw std::runtime_error(error[0] ? error : "Local inference failed");
}
#endif
napi_value invoke(napi_env env, napi_callback_info info) {
#ifdef JNBOT_NEEDLE_UNSUPPORTED
  napi_throw_error(env, "AI_UNSUPPORTED_PLATFORM", "Local inference is unavailable on this architecture.");
  return nullptr;
#else
  try {
    size_t count = 5;
    napi_value args[5], result;
    check(napi_get_cb_info(env, info, &count, args, nullptr, nullptr));
    if (!count) throw std::runtime_error("Operation required");
    void *data;
    check(napi_get_instance_data(env, &data));
    auto &state = *static_cast<State *>(data);
    const auto op = text(env, args[0]);
    char error[2048] = {};
    check(napi_get_undefined(env, &result));
    if (op == "identity") {
      check(napi_create_string_utf8(env, eg_source_sha256(), NAPI_AUTO_LENGTH, &result));
    } else if (op == "close") {
      state.close();
    } else if (op == "load" && count == 4) {
      const auto file = text(env, args[1]);
      const auto offset = integer(env, args[2]), length = integer(env, args[3]);
      state.close();
      state.decoder = np_load(file.c_str(), offset, length, 4, error, sizeof error);
      if (!state.decoder) throw std::runtime_error(error);
    } else if (!state.decoder) {
      throw std::runtime_error("Model not loaded");
    } else if (op == "attach" && count == 2) {
      size_t size;
      auto values = array<float>(env, args[1], napi_float32_array, size);
      engine_check(np_representation_attach(state.decoder, values, size, error, sizeof error), error);
    } else if (op == "encoder" && count == 4) {
      const auto file = text(env, args[1]);
      const auto offset = integer(env, args[2]), context = integer(env, args[3]);
      if (context < 1 || context > 8192) throw std::runtime_error("Invalid encoder context");
      eg_free(state.encoder); state.encoder = nullptr;
      state.encoder = eg_load(file.c_str(), offset, int32_t(context), 4, "cpu", error, sizeof error);
      if (!state.encoder) throw std::runtime_error(error);
    } else if (op == "eval" && count == 3) {
      size_t input_size, output_size;
      auto input = array<int32_t>(env, args[1], napi_int32_array, input_size);
      auto output = array<float>(env, args[2], napi_float32_array, output_size);
      engine_check(np_eval(state.decoder, input, input_size, output, output_size, error, sizeof error), error);
    } else if (op == "prefix" && count == 2) {
      engine_check(np_prefix(state.decoder, size_t(integer(env, args[1])), error, sizeof error), error);
    } else if (op == "confidence" && count == 1) {
      float confidence = 0;
      const int available = np_confidence(state.decoder, &confidence, error, sizeof error);
      engine_check(available, error);
      if (available) check(napi_create_double(env, confidence, &result));
      else check(napi_get_null(env, &result));
    } else if (op == "similarity" && count == 4) {
      size_t matrix_size, query_size, output_size;
      const auto matrix = array<float>(env, args[1], napi_float32_array, matrix_size);
      const auto query = array<float>(env, args[2], napi_float32_array, query_size);
      auto scores = array<float>(env, args[3], napi_float32_array, output_size);
      if (query_size != 768 || matrix_size % 768 || output_size != matrix_size / 768)
        throw std::runtime_error("Invalid similarity dimensions");
      if (output_size > INT_MAX) throw std::runtime_error("Too many tool vectors");
      if (output_size)
        cblas_sgemv(CblasRowMajor, CblasNoTrans, int(output_size), 768, 1.f,
                    matrix, 768, query, 1, 0.f, scores, 1);
      for (size_t i = 0; i < output_size; ++i) {
        if (!std::isfinite(scores[i])) throw std::runtime_error("Invalid similarity score");
        scores[i] = std::fmax(-1.f, std::fmin(1.f, scores[i]));
      }
    } else if (op == "prepare" && count == 1) {
      if (!state.pending) throw std::runtime_error("No query encoding is pending");
      const auto &query = *state.pending;
      engine_check(np_representation_prepare(state.decoder, query.features.data(), query.tokens, query.pooled.data(), query.pooled.size(), error, sizeof error), error);
      state.pending.reset();
    } else if (op == "encode" && (count == 3 || count == 4)) {
      if (!state.encoder) throw std::runtime_error("Embeddings are unavailable for this model");
      const auto input = text(env, args[1]);
      bool prepare, defer = false;
      check(napi_get_value_bool(env, args[2], &prepare));
      if (count == 4) check(napi_get_value_bool(env, args[3], &defer));
      if (prepare && defer) throw std::runtime_error("Cannot prepare and defer together");
      state.pending.reset();
      const int tokens = eg_token_count(state.encoder, input.c_str(), error, sizeof error);
      engine_check(tokens, error);
      if (tokens < 1 || tokens > 8192) throw std::runtime_error("Invalid encoder token count");
      std::vector<float> features(size_t(tokens) * 512), pooled(768);
      const int written = eg_encode(state.encoder, input.c_str(), features.data(), features.size(), pooled.data(), pooled.size(), error, sizeof error);
      engine_check(written, error);
      if (written != tokens) throw std::runtime_error("Incomplete encoder output");
      for (float value : features) if (!std::isfinite(value)) throw std::runtime_error("Invalid encoder features");
      double norm = 0;
      for (float value : pooled) {
        if (!std::isfinite(value)) throw std::runtime_error("Invalid embedding");
        norm += double(value) * value;
      }
      if (std::abs(std::sqrt(norm) - 1.) > 2e-5) throw std::runtime_error("Embedding is not normalized");
      if (prepare) engine_check(np_representation_prepare(state.decoder, features.data(), tokens, pooled.data(), pooled.size(), error, sizeof error), error);
      void *buffer;
      napi_value storage;
      check(napi_create_arraybuffer(env, pooled.size() * sizeof(float), &buffer, &storage));
      std::memcpy(buffer, pooled.data(), pooled.size() * sizeof(float));
      check(napi_create_typedarray(env, napi_float32_array, pooled.size(), storage, 0, &result));
      if (defer) state.pending = std::make_unique<PendingEncoding>(PendingEncoding{std::move(features), std::move(pooled), tokens});
    } else if (op == "reset" && count == 1) {
      state.pending.reset();
      np_reset(state.decoder);
    } else if (op == "stats" && count == 1) {
      np_memory_info memory{};
      engine_check(np_memory_stats(state.decoder, &memory, error, sizeof error), error);
      check(napi_create_object(env, &result));
      auto property = [&](const char *name, double number) {
        napi_value value;
        check(napi_create_double(env, number, &value));
        check(napi_set_named_property(env, result, name, value));
      };
      property("encoderLoaded", state.encoder ? 1 : 0);
      property("mappedWeightsBytes", double(memory.mapped_weights_bytes));
      property("workspaceBytes", double(memory.decoded_workspace_bytes));
      property("prefixReusedTokens", double(np_prefix_reused(state.decoder)));
      property("prefixReusedLayers", double(np_prefix_reused_layers(state.decoder)));
    } else {
      throw std::runtime_error("Invalid native operation or arguments");
    }
    return result;
  } catch (const std::exception &error) {
    napi_throw_error(env, "AI_ENGINE", error.what());
    return nullptr;
  }
#endif
}
napi_value initialize(napi_env env, napi_value exports) {
#ifndef JNBOT_NEEDLE_UNSUPPORTED
  auto state = std::make_unique<State>();
  if (napi_set_instance_data(env, state.get(), [](napi_env, void *p, void *) { delete static_cast<State *>(p); }, nullptr) != napi_ok) return nullptr;
  state.release();
#endif
  napi_value function;
  if (napi_create_function(env, "invoke", NAPI_AUTO_LENGTH, invoke, nullptr, &function) != napi_ok) return nullptr;
  if (napi_set_named_property(env, exports, "invoke", function) != napi_ok) return nullptr;
  return exports;
}
}
#ifdef JNBOT_NEEDLE_LINKED
static napi_module linked_module = { NAPI_MODULE_VERSION, 2, __FILE__, initialize, "jnbot_needle", nullptr, {0} };
extern "C" void jnbot_needle_register() {
  static bool registered = false;
  if (!registered) { registered = true; napi_module_register(&linked_module); }
}
#else
NAPI_MODULE(jnbot_needle, initialize)
#endif
