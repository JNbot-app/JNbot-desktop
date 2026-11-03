#include "internal.h"
#include <algorithm>
#include <cmath>

namespace needle_cpu {
static std::vector<float> decoded(const Tensor &t) {
    std::vector<float> result(t.elements);
    if (t.kind <= 2) {
        for (size_t i = 0; i < result.size(); ++i) result[i] = t.scalar(i);
    } else {
        for (size_t r = 0; r < t.shape[0]; ++r) t.row(r, result.data() + r * t.shape[1]);
    }
    return result;
}
ConfidencePool::ConfidencePool(const Model &model) {
    const size_t offset = model.confidence_head;
    rows = model.h[10] + 1;
    width = model.h[7];
    probes = decoded(model.tensor(offset));
    probes_per_row = probes.size() / (rows * width);
    query = decoded(model.tensor(offset + 2));
    queries = query.size() / width;
    gain = decoded(model.tensor(offset + 1));
    bias = decoded(model.tensor(offset + 3));
    projection = decoded(model.tensor(offset + 4));
    output_bias = model.tensor(offset + 5).scalar(0);
    maximum.resize(rows * probes_per_row);
    mass.resize(maximum.size());
    sums.resize(maximum.size() * width);
    reset();
}
void ConfidencePool::reset() {
    std::fill(maximum.begin(), maximum.end(), -INFINITY);
    std::fill(mass.begin(), mass.end(), 0.f);
    std::fill(sums.begin(), sums.end(), 0.f);
}
void ConfidencePool::add(size_t row, const float *cell) {
    const float scale = 1.f / std::sqrt(float(width));
    for (size_t k = row * probes_per_row; k < (row + 1) * probes_per_row; ++k) {
        float score = 0;
        for (size_t d = 0; d < width; ++d) score += cell[d] * probes[k * width + d];
        score *= scale;
        float next = std::max(maximum[k], score);
        float old_weight = std::exp(maximum[k] - next), weight = std::exp(score - next);
        mass[k] = mass[k] * old_weight + weight;
        for (size_t d = 0; d < width; ++d)
            sums[k * width + d] = sums[k * width + d] * old_weight + cell[d] * weight;
        maximum[k] = next;
    }
}
float ConfidencePool::score() const {
    size_t count = mass.size();
    std::vector<float> pooled(sums.size()), weights(count), output(queries * width, 0.f);
    for (size_t k = 0; k < count; ++k) {
        if (!(mass[k] > 0)) throw std::runtime_error("Confidence pool has no tokens");
        float square = 0;
        for (size_t d = 0; d < width; ++d) {
            float value = sums[k * width + d] / mass[k];
            pooled[k * width + d] = value;
            square += value * value;
        }
        float scale = gain[k] / std::sqrt(square / float(width) + 1e-6f);
        for (size_t d = 0; d < width; ++d) pooled[k * width + d] *= scale;
    }
    for (size_t q = 0; q < queries; ++q) {
        for (size_t k = 0; k < count; ++k) {
            float dot = 0;
            for (size_t d = 0; d < width; ++d) dot += pooled[k * width + d] * query[q * width + d];
            weights[k] = dot / std::sqrt(float(width)) + bias[q * count + k];
        }
        softmax(weights.data(), count);
        for (size_t k = 0; k < count; ++k)
            for (size_t d = 0; d < width; ++d)
                output[q * width + d] += weights[k] * pooled[k * width + d];
    }
    float logit = output_bias;
    for (size_t i = 0; i < output.size(); ++i) logit += output[i] * projection[i];
    finite(&logit, 1);
    return sigmoid(logit);
}
size_t ConfidencePool::bytes() const {
    return sizeof(float) * (probes.capacity() + query.capacity() + gain.capacity() + bias.capacity() +
                           projection.capacity() + maximum.capacity() + mass.capacity() + sums.capacity());
}
} // namespace needle_cpu
