#pragma once
#include <array>
#include <memory>
#include <vector>

namespace needle_cpu {
inline constexpr std::array<size_t, 3> representation_blocks = {5, 9, 15};
inline int representation_site(size_t layer) {
    for (size_t site = 0; site < representation_blocks.size(); ++site)
        if (representation_blocks[site] == layer) return int(site);
    return -1;
}
struct RepresentationWeights {
    std::vector<float> values;
    std::array<size_t, 14> offsets{};
    bool dedicated = false;
    bool sink = false;
    RepresentationWeights(const float *, size_t);
    const float *tensor(size_t i) const { return values.data() + offsets.at(i); }
};
struct RepresentationRequest {
    std::shared_ptr<const RepresentationWeights> weights;
    bool ready = false;
    // Diagnostic: read token slots only, excluding the pooled query slot 0.
    bool mask_pooled = false;
    size_t entries = 0;
    // [site][KV head][entry][coordinate], independent of the rolling text KV.
    std::vector<float> keys, values, scores;
    std::array<float, 36> gates{};
    explicit RepresentationRequest(std::shared_ptr<const RepresentationWeights> w);
    void clear();
    void prepare(const float *, size_t, const float *, size_t, const float *);
    void read(size_t, const float *, float *);
    void read_dedicated(size_t, const float *, float *, size_t = 1);
};
} // namespace needle_cpu
