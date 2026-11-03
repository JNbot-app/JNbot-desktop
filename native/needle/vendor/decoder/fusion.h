#pragma once
#include <array>
#include <memory>
#include <vector>

namespace needle_cpu {
struct FusionWeights {
    std::vector<float> values;
    std::array<size_t, 28> offsets{};
    FusionWeights(const float *, size_t);
    const float *tensor(size_t i) const { return values.data() + offsets.at(i); }
};
struct FusionRequest {
    std::shared_ptr<const FusionWeights> weights;
    bool ready = false;
    std::array<float, 32 * 256> slots{};
    // [connection][head][slot][dimension]
    std::array<float, 2 * 4 * 32 * 64> keys{}, values{};
    std::vector<float> features, k, v, work;
    explicit FusionRequest(std::shared_ptr<const FusionWeights> w) : weights(std::move(w)) {}
    void prepare(const float *, size_t, int);
    void apply(size_t, float *, size_t, size_t);
};
} // namespace needle_cpu
