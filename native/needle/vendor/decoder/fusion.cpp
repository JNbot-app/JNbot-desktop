#include "internal.h"
#include <cmath>
#include <algorithm>

namespace needle_cpu {
namespace {
constexpr size_t sizes[] = {
    256, // 0: bridge/input_projection/bias
    131072, // 1: bridge/input_projection/kernel
    8192, // 2: bridge/latent_slots
    512, // 3: bridge/mlp_dense1/bias
    131072, // 4: bridge/mlp_dense1/kernel
    256, // 5: bridge/mlp_dense2/bias
    131072, // 6: bridge/mlp_dense2/kernel
    256, // 7: bridge/norm_1/bias
    256, // 8: bridge/norm_1/scale
    256, // 9: bridge/norm_2/bias
    256, // 10: bridge/norm_2/scale
    65536, // 11: bridge/slot_cross_attn/k_proj/kernel
    65536, // 12: bridge/slot_cross_attn/out_proj/kernel
    65536, // 13: bridge/slot_cross_attn/q_proj/kernel
    65536, // 14: bridge/slot_cross_attn/v_proj/kernel
    512, // 15: bridge/task_embedding
    1, // 16: gate_block19/gate_alpha
    65536, // 17: gate_block19/k_proj/kernel
    768, // 18: gate_block19/norm/scale
    196608, // 19: gate_block19/out_proj/kernel
    196608, // 20: gate_block19/q_proj/kernel
    65536, // 21: gate_block19/v_proj/kernel
    1, // 22: gate_block9/gate_alpha
    65536, // 23: gate_block9/k_proj/kernel
    768, // 24: gate_block9/norm/scale
    196608, // 25: gate_block9/out_proj/kernel
    196608, // 26: gate_block9/q_proj/kernel
    65536, // 27: gate_block9/v_proj/kernel
};
void linear(const float *x, const float *w, const float *b, float *y,
            size_t rows, size_t in, size_t out) {
    dense(x, w, y, rows, in, out);
    if (b)
        for (size_t r = 0; r < rows; ++r)
            for (size_t c = 0; c < out; ++c) y[r * out + c] += b[c];
}
void layernorm(float *x, const float *scale, const float *bias) {
    float mean = 0, square = 0;
    for (size_t i = 0; i < 256; ++i) { mean += x[i]; square += x[i] * x[i]; }
    mean /= 256.f;
    float inverse = 1.f / std::sqrt(std::max(0.f, square / 256.f - mean * mean) + 1e-6f);
    for (size_t i = 0; i < 256; ++i) x[i] = (x[i] - mean) * inverse * scale[i] + bias[i];
}
void attend(const float *q, const float *k, const float *v, size_t queries,
            size_t tokens, float *out) {
    std::vector<float> scores(tokens);
    for (size_t r = 0; r < queries; ++r)
        for (size_t h = 0; h < 4; ++h) {
            for (size_t t = 0; t < tokens; ++t) {
                float dot = 0;
                for (size_t d = 0; d < 64; ++d)
                    dot += q[r * 256 + h * 64 + d] * k[t * 256 + h * 64 + d];
                scores[t] = dot * .125f;
            }
            softmax(scores.data(), tokens);
            for (size_t d = 0; d < 64; ++d) {
                float sum = 0;
                for (size_t t = 0; t < tokens; ++t)
                    sum += scores[t] * v[t * 256 + h * 64 + d];
                out[r * 256 + h * 64 + d] = sum;
            }
        }
}
} // namespace
FusionWeights::FusionWeights(const float *input, size_t count) {
    size_t total = 0;
    for (size_t i = 0; i < 28; ++i) { offsets[i] = total; total += sizes[i]; }
    if (!input || count != total) throw std::invalid_argument("Invalid fusion weight buffer");
    finite(input, count);
    values.assign(input, input + count);
}
void FusionRequest::prepare(const float *input, size_t tokens, int task) {
    ready = false;
    if (!input || !tokens || tokens > 8192 || (task != 0 && task != 1))
        throw std::invalid_argument("Invalid fusion features or task");
    finite(input, tokens * 512);
    const auto w = [&](size_t i) { return weights->tensor(i); };
    features.resize(tokens * 256); k.resize(tokens * 256); v.resize(tokens * 256);
    linear(input, w(1), w(0), features.data(), tokens, 512, 256);
    for (size_t t = 0; t < tokens; ++t)
        for (size_t d = 0; d < 256; ++d) {
            float angle = float(t) * std::exp(-std::log(10000.f) * float(d / 2 * 2) / 256.f);
            features[t * 256 + d] += d % 2 ? std::cos(angle) : std::sin(angle);
            features[t * 256 + d] += w(15)[task * 256 + d];
        }
    std::array<float, 32 * 256> q{}, attention{}, projected{};
    linear(w(2), w(13), nullptr, q.data(), 32, 256, 256);
    linear(features.data(), w(11), nullptr, k.data(), tokens, 256, 256);
    linear(features.data(), w(14), nullptr, v.data(), tokens, 256, 256);
    attend(q.data(), k.data(), v.data(), 32, tokens, attention.data());
    linear(attention.data(), w(12), nullptr, projected.data(), 32, 256, 256);
    for (size_t i = 0; i < slots.size(); ++i) slots[i] = w(2)[i] + projected[i];
    for (size_t r = 0; r < 32; ++r) layernorm(slots.data() + r * 256, w(8), w(7));
    work.resize(32 * 512);
    linear(slots.data(), w(4), w(3), work.data(), 32, 256, 512);
    for (float &x : work) x = .5f * x * (1.f + std::tanh(.7978845608028654f * (x + .044715f * x * x * x)));
    linear(work.data(), w(6), w(5), projected.data(), 32, 512, 256);
    for (size_t i = 0; i < slots.size(); ++i) slots[i] += projected[i];
    for (size_t r = 0; r < 32; ++r) layernorm(slots.data() + r * 256, w(10), w(9));
    for (size_t site = 0; site < 2; ++site) {
        size_t base = site == 0 ? 22 : 16;
        linear(slots.data(), w(base + 1), nullptr, q.data(), 32, 256, 256);
        linear(slots.data(), w(base + 5), nullptr, attention.data(), 32, 256, 256);
        for (size_t h = 0; h < 4; ++h)
            for (size_t t = 0; t < 32; ++t)
                for (size_t d = 0; d < 64; ++d) {
                    size_t index = site * 8192 + (h * 32 + t) * 64 + d;
                    keys[index] = q[t * 256 + h * 64 + d];
                    values[index] = attention[t * 256 + h * 64 + d];
                }
    }
    finite(slots.data(), slots.size()); finite(keys.data(), keys.size()); finite(values.data(), values.size());
    ready = true;
}
void FusionRequest::apply(size_t site, float *stream, size_t count, size_t lanes) {
    if (!ready) return;
    const size_t base = site == 0 ? 22 : 16;
    const auto w = [&](size_t i) { return weights->tensor(i); };
    const float gate = *w(base);
    if (gate == 0.f) return; // Exactly preserve the non-fusion decoder.
    work.resize(count * (768 + 256 + 256 + 768));
    float *mean = work.data(), *q = mean + count * 768,
          *attention = q + count * 256, *delta = attention + count * 256;
    for (size_t t = 0; t < count; ++t) {
        for (size_t d = 0; d < 768; ++d) {
            float sum = 0;
            for (size_t lane = 0; lane < lanes; ++lane) sum += stream[(t * lanes + lane) * 768 + d];
            mean[t * 768 + d] = sum / float(lanes);
        }
        norm(mean + t * 768, mean + t * 768, 768, w(base + 2));
    }
    linear(mean, w(base + 4), nullptr, q, count, 768, 256);
    for (size_t t = 0; t < count; ++t)
        for (size_t h = 0; h < 4; ++h) {
            std::array<float, 32> scores{};
            for (size_t s = 0; s < 32; ++s) {
                float dot = 0;
                for (size_t d = 0; d < 64; ++d)
                    dot += q[t * 256 + h * 64 + d] * keys[site * 8192 + (h * 32 + s) * 64 + d];
                scores[s] = dot * .125f;
            }
            softmax(scores.data(), 32);
            for (size_t d = 0; d < 64; ++d) {
                float sum = 0;
                for (size_t s = 0; s < 32; ++s)
                    sum += scores[s] * values[site * 8192 + (h * 32 + s) * 64 + d];
                attention[t * 256 + h * 64 + d] = sum;
            }
        }
    linear(attention, w(base + 3), nullptr, delta, count, 256, 768);
    for (size_t t = 0; t < count; ++t)
        for (size_t lane = 0; lane < lanes; ++lane)
            for (size_t d = 0; d < 768; ++d)
                stream[(t * lanes + lane) * 768 + d] += gate * delta[t * 768 + d];
    finite(stream, count * lanes * 768);
}
} // namespace needle_cpu
