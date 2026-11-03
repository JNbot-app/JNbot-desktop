#include "internal.h"
#include <algorithm>
#include <cmath>
#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#else
#include <cblas.h>
#endif

namespace needle_cpu {
namespace {
constexpr size_t sizes[] = {512*128, 768*128, 128, 128, 128, 128, 128, 3*128*96, 3*128*128, 36};
constexpr size_t reader_sizes[] = {512*128, 768*128, 128, 128, 128, 128, 128, 3*128*96, 3*128*128, 12,
                                  3*768*192, 3*48, 3*256*768};
float sum_tree(float *x, size_t count) {
    size_t width = 1;
    while (width < count) width *= 2;
    std::fill(x+count, x+width, 0.f);
    while (width > 1) {
        for (size_t i = 0; i < width/2; ++i) x[i] = x[2*i]+x[2*i+1];
        width /= 2;
    }
    return x[0];
}
void project(const float *x, const float *w, float *out, size_t rows, size_t in, size_t width) {
    cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans,
                int(rows), int(width), int(in),
                1.0f, x, int(in),
                w, int(width),
                0.0f, out, int(width));
}
void layernorm(float *x, const float *scale, const float *bias) {
    std::array<float, 128> scratch{}, centered{};
    std::copy_n(x, 128, scratch.data());
    float mean = sum_tree(scratch.data(), 128) / 128.f;
    for (size_t i = 0; i < 128; ++i) { centered[i] = x[i]-mean; scratch[i] = centered[i]*centered[i]; }
    float inverse = 1.f / std::sqrt(sum_tree(scratch.data(), 128)/128.f + 1e-6f);
    for (size_t i = 0; i < 128; ++i) x[i] = centered[i]*inverse*scale[i]+bias[i];
}
void keynorm(const float *x, float *out, const float *scale) {
    std::array<float, 64> square{};
    for (size_t i = 0; i < 48; ++i) square[i] = x[i]*x[i];
    float root = std::sqrt(sum_tree(square.data(), 48)/48.f + 1e-6f);
    for (size_t i = 0; i < 48; ++i) out[i] = (1.f+scale[i])*x[i]/root;
}
} // namespace
RepresentationWeights::RepresentationWeights(const float *input, size_t count) {
    size_t total = 0;
    size_t reader_count = 0;
    for (auto n : reader_sizes) reader_count += n;
    sink = count == reader_count + 12;
    dedicated = count == reader_count || sink;
    for (size_t i = 0; i < (dedicated ? 13 : 10); ++i) {
        offsets[i] = total; total += dedicated ? reader_sizes[i] : sizes[i];
    }
    if (sink) { offsets[13] = total; total += 12; }
    if (!input || count != total) throw std::invalid_argument("Invalid representation weight count");
    finite(input, count);
    values.assign(input, input + count);
}
RepresentationRequest::RepresentationRequest(std::shared_ptr<const RepresentationWeights> w)
    : weights(std::move(w)) {
    for (size_t h = 0; h < (weights->dedicated ? 12 : gates.size()); ++h)
        gates[h] = std::tanh(weights->tensor(9)[h]);
}
void RepresentationRequest::clear() {
    ready = false;
    entries = 0;
    keys.clear(); values.clear(); scores.clear();
}
void RepresentationRequest::prepare(const float *features, size_t tokens, const float *pooled,
                                     size_t pooled_count, const float *key_scale) {
    clear(); // Failed preparation cannot leave the previous query active.
    if (!features || !pooled || !tokens || tokens > 8192 || pooled_count != 768)
        throw std::invalid_argument("Invalid representation features/pooled dimensions");
    finite(features, tokens * 512); finite(pooled, 768);
    double square = 0.;
    for (size_t i = 0; i < 768; ++i) square += double(pooled[i])*pooled[i];
    if (std::abs(std::sqrt(square)-1.) > 2e-5)
        throw std::invalid_argument("Representation pooled embedding must be unit L2");
    const auto w = [&](size_t i) { return weights->tensor(i); };
    entries = tokens + 1;
    keys.resize(3 * 2 * entries * 48); values.resize(3 * 2 * entries * 64); scores.resize(entries);
    // Only preparation needs projected states; deployment retains K/V and scores.
    std::vector<float> z(entries * 128), raw_keys(entries * 96), raw_values(entries * 128);
    project(pooled, w(1), z.data(), 1, 768, 128);
    for (size_t d = 0; d < 128; ++d) z[d] += w(6)[d];
    layernorm(z.data(), w(4), w(5));
    project(features, w(0), z.data() + 128, tokens, 512, 128);
    std::array<double, 64> denominator{};
    for (size_t i = 0; i < 64; ++i) denominator[i] = std::pow(10000., double(2*i)/128.);
    for (size_t t = 0; t < tokens; ++t) {
        float *row = z.data() + (t+1)*128;
        for (size_t i = 0; i < 64; ++i) {
            double angle = double(t)/denominator[i];
            row[2*i] += float(std::sin(angle)); row[2*i+1] += float(std::cos(angle));
        }
        layernorm(row, w(2), w(3));
    }
    for (size_t site = 0; site < representation_blocks.size(); ++site) {
        project(z.data(), w(7)+site*128*96, raw_keys.data(), entries, 128, 96);
        project(z.data(), w(8)+site*128*128, raw_values.data(), entries, 128, 128);
        for (size_t t = 0; t < entries; ++t)
            for (size_t h = 0; h < 2; ++h) {
                keynorm(raw_keys.data() + t*96+h*48, keys.data()+((site*2+h)*entries+t)*48, key_scale+site*48);
                std::copy_n(raw_values.data()+t*128+h*64, 64, values.data()+((site*2+h)*entries+t)*64);
            }
    }
    finite(keys.data(), keys.size()); finite(values.data(), values.size());
    ready = true;
}
void RepresentationRequest::read(size_t site, const float *query, float *output) {
    if (site >= representation_blocks.size()) throw std::invalid_argument("Invalid representation site");
    if (!ready) return;
    const size_t heads = weights->dedicated ? 4 : 12;
    const size_t first = mask_pooled && entries > 1 ? 1 : 0, count = entries - first;
    for (size_t h = 0; h < heads; ++h) {
        const float gate = gates[site*heads+h];
        if (gate == 0.f) continue;
        const size_t kh = h/(heads/2);
        const float *q = query+h*48, *k = keys.data()+((site*2+kh)*entries+first)*48,
                    *v = values.data()+((site*2+kh)*entries+first)*64;
        scores.resize(count);
        cblas_sgemv(CblasRowMajor, CblasNoTrans, int(count), 48,
                    1.0f / std::sqrt(48.0f), k, 48, q, 1, 0.0f, scores.data(), 1);
        if (weights->sink) {
            const float sink = weights->tensor(13)[site*heads+h];
            const float maximum = std::max(sink, *std::max_element(scores.begin(), scores.end()));
            float denominator = std::exp(sink-maximum);
            for (float &score : scores) { score = std::exp(score-maximum); denominator += score; }
            for (float &score : scores) score /= denominator;
        } else {
            softmax(scores.data(), count);
        }
        cblas_sgemv(CblasRowMajor, CblasTrans, int(count), 64,
                    gate, v, 64, scores.data(), 1, 1.0f, output + h * 64, 1);
    }
}
void RepresentationRequest::read_dedicated(size_t site, const float *input, float *output, size_t count) {
    if (site >= representation_blocks.size() || !weights->dedicated)
        throw std::invalid_argument("Invalid dedicated representation reader");
    if (!ready) return;
    if (count == 1) {
        std::array<float, 192> query{}, normalized{};
        std::array<float, 256> result{};
        std::array<float, 768> delta{};
        project(input, weights->tensor(10)+site*768*192, query.data(), 1, 768, 192);
        for (size_t h = 0; h < 4; ++h)
            keynorm(query.data()+h*48, normalized.data()+h*48, weights->tensor(11)+site*48);
        read(site, normalized.data(), result.data());
        project(result.data(), weights->tensor(12)+site*256*768, delta.data(), 1, 256, 768);
        for (size_t d = 0; d < 768; ++d) output[d] += delta[d];
        return;
    }

    std::vector<float> query(count * 192), normalized(count * 192);
    std::vector<float> result(count * 256);
    std::vector<float> delta(count * 768);
    project(input, weights->tensor(10)+site*768*192, query.data(), count, 768, 192);
    for (size_t t = 0; t < count; ++t) {
        for (size_t h = 0; h < 4; ++h)
            keynorm(query.data() + t * 192 + h * 48, normalized.data() + t * 192 + h * 48, weights->tensor(11)+site*48);
        read(site, normalized.data() + t * 192, result.data() + t * 256);
    }
    project(result.data(), weights->tensor(12)+site*256*768, delta.data(), count, 256, 768);
    for (size_t t = 0; t < count; ++t) {
        float *out_t = output + t * 768;
        const float *del_t = delta.data() + t * 768;
        for (size_t d = 0; d < 768; ++d) out_t[d] += del_t[d];
    }
}
} // namespace needle_cpu
