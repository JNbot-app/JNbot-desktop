#include "internal.h"
#include "kernels.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <type_traits>

using namespace needle_cpu;
namespace {
void message(char *error, size_t capacity, const char *text) {
    if (error && capacity)
        std::snprintf(error, capacity, "%s", text);
}
template <class F> int32_t guard(char *error, size_t capacity, F &&f) {
    try {
        return f();
    } catch (const std::exception &e) {
        message(error, capacity, e.what());
        return -1;
    }
}
void require(bool condition, const char *text) {
    if (!condition)
        throw std::invalid_argument(text);
}
Math &math(np_handle *h) {
    if (h->decoder)
        return h->decoder->math;
    if (!h->math)
        h->math = std::make_unique<Math>(h->workers);
    return *h->math;
}
void tokens_valid(np_handle *h, const int32_t *tokens, size_t count, size_t position = 0) {
    require(tokens && count, "Missing decoder input");
    require(position <= h->model->h[13] && count <= h->model->h[13] - position,
            "Needle context limit exceeded");
    for (size_t i = 0; i < count; ++i)
        require(tokens[i] >= 0 && uint32_t(tokens[i]) < h->model->h[5],
                "Token ID outside Needle vocabulary");
}
size_t vocab(np_handle *h) { return h->model->h[6] ? h->model->h[6] : h->model->h[5]; }
} // namespace
uint32_t np_abi_version() { return 1; }
np_handle *np_load(const char *path, uint64_t offset, uint64_t length, int32_t threads, char *error,
                   size_t capacity) {
    try {
        require(path && threads > 0, "Invalid model options");
        (void)cpu_kernels(); // Fail unsupported diagnostic overrides before loading weights.
        auto h = std::make_unique<np_handle>();
        h->model = std::make_shared<Model>(path, offset, length);
        h->threads = size_t(threads);
        h->workers = std::make_shared<ProjectionWorkers>(h->threads);
        return h.release();
    } catch (const std::exception &e) {
        message(error, capacity, e.what());
        return nullptr;
    }
}
np_handle *np_clone(np_handle *source, char *error, size_t capacity) {
    try {
        require(source, "Missing model handle");
        std::lock_guard<std::mutex> lock(source->mutex);
        auto h = std::make_unique<np_handle>();
        h->model = source->model;
        h->threads = source->threads;
        if (source->fusion)
            h->fusion = std::make_shared<FusionRequest>(source->fusion->weights);
        if (source->representation) {
            h->representation = std::make_shared<RepresentationRequest>(source->representation->weights);
            h->representation->mask_pooled = source->representation->mask_pooled;
        }
        h->workers = std::make_shared<ProjectionWorkers>(h->threads);
        return h.release();
    } catch (const std::exception &e) {
        message(error, capacity, e.what());
        return nullptr;
    }
}
void np_free(np_handle *h) { delete h; }
void np_reset(np_handle *h) {
    if (h) {
        std::lock_guard<std::mutex> lock(h->mutex);
        if (h->decoder)
            h->decoder->reset();
        if (h->fusion)
            h->fusion->ready = false;
        if (h->representation) h->representation->clear();
    }
}
int32_t np_prefix(np_handle *h, size_t count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing decoder handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(!h->decoder || h->decoder->position == 0, "Reset before changing tool prefix");
        if (!h->decoder) {
            h->math.reset();
            h->decoder = std::make_unique<Decoder>(h->model, h->workers);
            h->decoder->fusion = h->fusion;
            h->decoder->representation = h->representation;
        }
        // Bound cached boundary streams and engrams to 16 MiB, plus one KV snapshot.
        auto &d = *h->decoder;
        const size_t chunk_bytes = (d.n + d.sites * 2) * batch_size * d.d * sizeof(float);
        const size_t cap = (16 * 1024 * 1024 / chunk_bytes) * batch_size;
        count = std::min(count, cap) / batch_size * batch_size;
        if (d.prefix.requested != count) d.prefix = {};
        d.prefix.requested = count;
        return 0;
    });
}
size_t np_prefix_reused(np_handle *h) {
    if (!h) return 0;
    std::lock_guard<std::mutex> lock(h->mutex);
    return h->decoder ? h->decoder->prefix.reused : 0;
}
size_t np_prefix_reused_layers(np_handle *h) {
    if (!h) return 0;
    std::lock_guard<std::mutex> lock(h->mutex);
    return h->decoder && h->decoder->prefix.reused ? h->decoder->prefix.layers : 0;
}
size_t np_decoded_buffer_bytes(np_handle *h) {
    if (!h)
        return 0;
    std::lock_guard<std::mutex> lock(h->mutex);
    return (h->decoder || h->math) ? tile_bytes : 0;
}
int32_t np_memory_stats(np_handle *h,np_memory_info *out,char *error,size_t capacity) {
    return guard(error,capacity,[&] {
        require(h && out,"Missing memory statistics output");
        std::lock_guard<std::mutex> lock(h->mutex);
        *out = {};
        out->mapped_weights_bytes=h->model->mapping->size;
        auto bytes=[](const auto &v) { return uint64_t(v.capacity())*sizeof(typename std::decay_t<decltype(v)>::value_type); };
        const Math *m=h->decoder?&h->decoder->math:h->math.get();
        if(m) { out->decoded_workspace_bytes=bytes(m->tile);out->scratch_bytes=bytes(m->rotated_input); }
        if(h->decoder) {
            const auto &d=*h->decoder;
            for(const auto &kv:d.cache)
                out->kv_bytes+=bytes(kv.k)+bytes(kv.v)+bytes(kv.ks)+bytes(kv.vs);
            out->scratch_bytes+=bytes(d.scratch)+bytes(d.stream)+bytes(d.memory)+bytes(d.gathered)+bytes(d.angles)+
                                bytes(d.token_history)+bytes(d.p1)+bytes(d.p2)+bytes(d.last_hidden);
            if (d.confidence) out->scratch_bytes += d.confidence->bytes();
            for(const auto *history:{&d.qhist,&d.khist,&d.vhist,&d.ehist})
                for(const auto &ring:*history)out->scratch_bytes+=bytes(ring.data);
        }
        if(h->fusion) {
            const auto &f=*h->fusion;
            out->scratch_bytes+=sizeof(f.slots)+sizeof(f.keys)+sizeof(f.values)+
                                bytes(f.features)+bytes(f.k)+bytes(f.v)+bytes(f.work);
        }
        if(h->representation) {
            const auto &r=*h->representation;
            out->kv_bytes+=bytes(r.keys)+bytes(r.values);
            out->scratch_bytes+=bytes(r.scores)+sizeof(r.gates);
        }
        return int32_t(0);
    });
}
int32_t np_tensor_info(np_handle *h, int32_t index, uint32_t *shape, uint32_t *kind, char *error,
                       size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && shape && kind, "Missing tensor info output");
        std::lock_guard<std::mutex> lock(h->mutex);
        const Tensor &t = h->model->tensor(index);
        std::copy(t.shape.begin(), t.shape.end(), shape);
        *kind = t.kind;
        return int32_t(t.ndim);
    });
}
int32_t np_row(np_handle *h, int32_t index, uint32_t row, float *output, size_t size, char *error,
               size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing row buffers");
        std::lock_guard<std::mutex> lock(h->mutex);
        const Tensor &t = h->model->tensor(index);
        require(size >= t.columns(), "Insufficient row output capacity");
        t.row(row, output);
        finite(output, t.columns());
        return int32_t(t.columns());
    });
}
int32_t np_matvec(np_handle *h, int32_t index, const float *input, size_t count, float *output,
                  size_t size, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && input && output, "Missing matrix buffers");
        std::lock_guard<std::mutex> lock(h->mutex);
        const Tensor &t = h->model->tensor(index);
        require(t.ndim == 2 && count == t.shape[1] && size >= t.shape[0],
                "Matrix-vector dimensions differ");
        finite(input, count);
        math(h).project(t, input, 1, output);
        finite(output, t.shape[0]);
        return int32_t(t.shape[0]);
    });
}
static int32_t forward(np_handle *h, const int32_t *tokens, size_t count, float *output,
                       size_t size, float *hidden, size_t hidden_size, Trace trace, char *error,
                       size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing decoder output");
        std::lock_guard<std::mutex> lock(h->mutex);
        tokens_valid(h, tokens, count);
        require(size >= vocab(h) &&
                    (!hidden || hidden_size >= (size_t(h->model->h[10]) + 2) * h->model->h[7]),
                "Insufficient decoder output capacity");
        Decoder decoder(h->model, h->workers);
        decoder.fusion = h->fusion;
        decoder.representation = h->representation;
        decoder.run(tokens, count, output, hidden, trace);
        return int32_t(vocab(h));
    });
}
int32_t np_forward(np_handle *h, const int32_t *tokens, size_t count, float *output, size_t size,
                   float *hidden, size_t hidden_size, char *error, size_t capacity) {
    return forward(h, tokens, count, output, size, hidden, hidden_size, {}, error, capacity);
}
int32_t np_forward_trace(np_handle *h, const int32_t *tokens, size_t count, float *output,
                         size_t size, np_trace_callback callback, void *user, char *error,
                         size_t capacity) {
    if (!callback) {
        message(error, capacity, "Missing trace callback");
        return -1;
    }
    return forward(h, tokens, count, output, size, nullptr, 0, Trace{callback, user}, error,
                   capacity);
}
int32_t np_eval(np_handle *h, const int32_t *tokens, size_t count, float *output, size_t size,
                char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing cached decoder output");
        std::lock_guard<std::mutex> lock(h->mutex);
        tokens_valid(h, tokens, count, h->decoder ? h->decoder->position : 0);
        require(size >= vocab(h), "Insufficient decoder output capacity");
        if (!h->decoder) {
            h->math.reset();
            h->decoder = std::make_unique<Decoder>(h->model, h->workers);
            h->decoder->fusion = h->fusion;
            h->decoder->representation = h->representation;
        }
        try {
            h->decoder->run(tokens, count, output);
        } catch (...) {
            h->decoder->reset();
            if (h->fusion) h->fusion->ready = false;
            if (h->representation) h->representation->clear();
            throw;
        }
        return int32_t(vocab(h));
    });
}
int32_t np_decode(np_handle *h, int32_t token, float *output, size_t size, char *error,
                  size_t capacity) {
    return np_eval(h, &token, 1, output, size, error, capacity);
}
int32_t np_engram(np_handle *h, const int32_t *tokens, size_t count, float *output, size_t size,
                  char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing engram output");
        std::lock_guard<std::mutex> lock(h->mutex);
        tokens_valid(h, tokens, count);
        Decoder decoder(h->model, h->workers);
        require(size >= decoder.sites * 2 * decoder.d, "Insufficient engram output capacity");
        size_t last_count = 0;
        for (size_t i = 0; i < count; i += batch_size) {
            last_count = std::min(batch_size, count - i);
            decoder.used = 0;
            decoder.engram(tokens + i, last_count);
            decoder.position += last_count;
        }
        for (size_t site = 0; site < decoder.sites; ++site)
            for (size_t part = 0; part < 2; ++part)
                std::copy_n(decoder.memory.data() + (site * 2 + part) * batch_size * decoder.d +
                                (last_count - 1) * decoder.d,
                            decoder.d, output + (site * 2 + part) * decoder.d);
        return int32_t(decoder.sites * 2 * decoder.d);
    });
}
int32_t np_replay_norm(np_handle *h, int32_t index, const float *input, size_t count, float *output,
                       size_t size, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && input && output && count && size >= count,
                "Invalid normalization replay buffers");
        std::lock_guard<std::mutex> lock(h->mutex);
        finite(input, count);
        const float *scale = nullptr;
        if (index != -1) {
            const Tensor &t = h->model->tensor(index);
            require(t.ndim == 1 && t.kind <= 2 && t.elements == count,
                    "Normalization scale dimensions differ");
            scale = t.floats();
        }
        norm(input, output, count, scale);
        return int32_t(count);
    });
}
int32_t np_replay_projection(np_handle *h, int32_t index, const float *input, size_t count,
                             float *output, size_t size, char *error, size_t capacity) {
    return np_matvec(h, index, input, count, output, size, error, capacity);
}
int32_t np_replay_rope(np_handle *h, uint32_t position, const float *input, size_t count,
                       float *output, size_t size, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && input && output && count && count % 2 == 0 && size >= count,
                "Invalid RoPE replay buffers");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(count == h->model->h[11] && position < h->model->h[13],
                "RoPE replay geometry differs");
        finite(input, count);
        std::copy_n(input, count, output);
        rope(output, count, position, h->model->theta);
        return int32_t(count);
    });
}
int32_t np_replay_a8(const float *input, size_t count, float *output, size_t size, char *error,
                     size_t capacity) {
    return guard(error, capacity, [&] {
        require(input && output && count && count <= 32768 && size >= count,
                "Invalid A8 replay buffers");
        finite(input, count);
        std::copy_n(input, count, output);
        a8(output, count);
        return int32_t(count);
    });
}
int32_t np_replay_convolution(np_handle *h, int32_t index, const float *input, size_t steps,
                              size_t width, float *output, size_t size, char *error,
                              size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && input && output && steps && width && size >= width,
                "Invalid convolution replay buffers");
        std::lock_guard<std::mutex> lock(h->mutex);
        const Tensor &t = h->model->tensor(index);
        require(t.ndim == 2 && t.kind <= 2 && width == t.shape[1] && steps <= t.shape[0],
                "Convolution replay dimensions differ");
        finite(input, steps * width);
        History history(t.shape[0], width);
        for (size_t i = 0; i < steps; ++i)
            history.convolve(input + i * width, output, i, t, 1, SIZE_MAX);
        return int32_t(width);
    });
}
void np_profile_enable(int32_t enable) {
    Profiler::set_enabled(enable != 0);
}
void np_profile_reset(void) {
    Profiler::reset();
}
int32_t np_profile_dump(char *buffer, size_t capacity) {
    std::string json = Profiler::dump_json();
    if (buffer && capacity > 0) {
        size_t len = std::min(capacity - 1, json.size());
        std::memcpy(buffer, json.data(), len);
        buffer[len] = '\0';
    }
    return int32_t(json.size());
}
void np_profile_print(void) {
    Profiler::print_summary();
}


int32_t np_fusion_attach(np_handle *h, const float *input, size_t count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing model handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        h->model->validate_decoder();
        require(h->model->h[7] == 768 && h->model->h[10] == 20 && h->model->h[15] == 4,
                "Unsupported fusion decoder geometry");
        require(!h->representation, "Cannot combine legacy and representation fusion");
        require(!h->decoder || h->decoder->position == 0, "Reset before attaching fusion");
        auto weights = std::make_shared<FusionWeights>(input, count);
        h->decoder.reset();
        h->fusion = std::make_shared<FusionRequest>(weights);
        return int32_t(0);
    });
}
int32_t np_fusion_prepare(np_handle *h, const float *features, size_t count, int32_t task,
                          char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing model handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(bool(h->fusion), "Fusion weights are not attached");
        require(!h->decoder || h->decoder->position == 0, "Reset before replacing fusion memory");
        h->fusion->prepare(features, count, task);
        return int32_t(0);
    });
}
int32_t np_fusion_memory(np_handle *h, float *output, size_t count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing fusion output");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(h->fusion && h->fusion->ready && count >= 40960, "Fusion memory unavailable or output too small");
        auto &f = *h->fusion;
        std::copy(f.slots.begin(), f.slots.end(), output);
        std::copy(f.keys.begin(), f.keys.end(), output + 8192);
        std::copy(f.values.begin(), f.values.end(), output + 24576);
        return int32_t(40960);
    });
}
int32_t np_fusion_replay(np_handle *h, int32_t site, float *stream, size_t count,
                         char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && stream && (site == 0 || site == 1) && count && count <= 8192,
                "Invalid fusion replay input");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(h->fusion && h->fusion->ready, "Fusion memory unavailable");
        finite(stream, count * 4 * 768);
        h->fusion->apply(size_t(site), stream, count, 4);
        return int32_t(0);
    });
}

uint32_t np_representation_abi_version() { return 4; }
int32_t np_representation_attach(np_handle *h, const float *input, size_t count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing model handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        h->model->validate_decoder();
        const auto &g = h->model->h;
        require(g[7]==768 && g[8]==12 && g[9]==2 && g[10]==20 && g[11]==48 && g[12]==64 && g[15]==4,
                "Unsupported representation decoder geometry");
        require(!h->fusion, "Cannot combine legacy and representation fusion");
        require(!h->decoder || h->decoder->position == 0, "Reset before attaching representation");
        auto weights = std::make_shared<RepresentationWeights>(input, count);
        h->representation = std::make_shared<RepresentationRequest>(weights);
        if (h->decoder) h->decoder->representation = h->representation;
        return int32_t(0);
    });
}
int32_t np_last_hidden(np_handle *h, float *output, size_t count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing hidden-state output");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(h->decoder && h->decoder->position > 0 && h->decoder->last_hidden.size() == count,
                "Cached hidden state unavailable");
        std::copy(h->decoder->last_hidden.begin(), h->decoder->last_hidden.end(), output);
        return int32_t(0);
    });
}
int32_t np_confidence(np_handle *h, float *output, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing confidence output");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(h->decoder && h->decoder->position > 0, "Cached request unavailable");
        if (!h->decoder->confidence) return int32_t(0);
        *output = h->decoder->confidence->score();
        return int32_t(1);
    });
}

int32_t np_representation_prepare(np_handle *h, const float *features, size_t tokens,
                                  const float *pooled, size_t pooled_count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing model handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(bool(h->representation), "Representation weights are not attached");
        require(!h->decoder || h->decoder->position == 0, "Reset before replacing representation memory");
        std::array<float, 3*48> scales{};
        for (size_t site = 0; site < representation_blocks.size(); ++site) {
            const auto &l = h->model->layers[representation_blocks[site]];
            std::copy_n(h->model->tensor(l.knorm).floats(), 48, scales.data()+site*48);
        }
        h->representation->prepare(features, tokens, pooled, pooled_count, scales.data());
        return int32_t(0);
    });
}
int32_t np_representation_disable(np_handle *h, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing model handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(!h->decoder || h->decoder->position == 0, "Reset before disabling representation memory");
        if (h->representation) h->representation->clear();
        return int32_t(0);
    });
}
// Diagnostic entry points follow the same additive extension ABI.
int32_t np_representation_mask_pooled(np_handle *h, int32_t enabled, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h, "Missing model handle");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(bool(h->representation), "Representation weights are not attached");
        h->representation->mask_pooled = enabled != 0;
        return int32_t(0);
    });
}
int32_t np_representation_memory(np_handle *h, float *output, size_t count, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && output, "Missing representation memory output");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(h->representation && h->representation->ready, "Representation memory unavailable");
        const auto &r = *h->representation;
        size_t size = r.keys.size()+r.values.size();
        require(count >= size, "Insufficient representation memory output");
        std::copy(r.keys.begin(), r.keys.end(), output);
        std::copy(r.values.begin(), r.values.end(), output+r.keys.size());
        return int32_t(r.entries);
    });
}
int32_t np_representation_replay(np_handle *h, int32_t site, const float *query, float *output, char *error, size_t capacity) {
    return guard(error, capacity, [&] {
        require(h && query && output && site >= 0 && h->representation && size_t(site) < representation_blocks.size(), "Invalid representation replay input");
        std::lock_guard<std::mutex> lock(h->mutex);
        require(h->representation && h->representation->ready, "Representation memory unavailable");
        const bool dedicated = h->representation->weights->dedicated;
        finite(query, dedicated ? 768 : 12*48);
        std::fill_n(output, 12*64, 0.f);
        if (dedicated) h->representation->read_dedicated(size_t(site), query, output);
        else h->representation->read(size_t(site), query, output);
        finite(output, 12*64);
        return int32_t(0);
    });
}
