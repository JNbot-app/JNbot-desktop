#pragma once
#include "needle.h"
#include "fusion.h"
#include "representation.h"
#include "profile.h"
#include "workers.h"
#include <array>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace needle_cpu {
constexpr size_t tile_bytes = 4 * 1024 * 1024;
constexpr size_t batch_size = 128;
struct Mapping {
    const uint8_t *data = nullptr;
    size_t size = 0;
    int fd = -1;
#ifdef _WIN32
    void *file_handle = nullptr;
    void *mapping_handle = nullptr;
#endif
    explicit Mapping(const char *);
    ~Mapping();
    Mapping(const Mapping &) = delete;
};
// Monarch factor weights. On ARM they stay FP16 in memory (half the bytes read per token) and
// are widened to FP32 inside the mixing loops, so results are bit-identical to FP32 storage.
#if defined(__aarch64__)
using factor_t = __fp16;
#else
using factor_t = float;
#endif
struct Tensor {
    uint32_t kind = 0, ndim = 0, group = 0, bits = 0, padded = 0;
    std::array<uint32_t, 4> shape{};
    size_t elements = 0, bytes = 0, packed_bytes = 0;
    const uint8_t *data = nullptr;
    std::vector<float> values; // FP16 parameters or group norms, never dense CQ weights.
    std::array<float, 16> book{};
    float scalar(size_t) const;
    const float *floats() const {
        return kind == 1 ? values.data() : reinterpret_cast<const float *>(data);
    }
    const factor_t *factors() const {
        return sizeof(factor_t) == 2 ? reinterpret_cast<const factor_t *>(data)
                                     : reinterpret_cast<const factor_t *>(floats());
    }
    void row(size_t, float *, bool rotated = false) const;
    size_t columns() const { return ndim < 2 ? (ndim ? shape[0] : 1) : shape[1]; }
};
struct Layer {
    uint32_t norm, q, k, v, qt, kt, vt, qnorm, knorm, gate, out, post, agate, pre;
    uint32_t diagonals, factors, cv, cu;
    bool grouped = false; // Monarch: one Hadamard factor matrix per group instead of one shared
};
struct Model {
    std::mutex validation_mutex;
    std::shared_ptr<Mapping> mapping;
    std::array<uint32_t, 48> h{};
    float theta;
    std::vector<Tensor> tensors;
    std::vector<Layer> layers;
    uint32_t mhc = 0, perms = 0, engrams = 0, final_norm = 0, confidence_head = 0;
    // First runtime LoRA tensor (0: none). Per attention target q, k, v, gate, out:
    // A FP16 [layers][rank][in], then B FP16 [layers][rank][out].
    uint32_t lora = 0;
    Model(const char *, uint64_t, uint64_t);
    const Tensor &tensor(int32_t) const;
    void validate_decoder();
};
struct Math {
    std::vector<float> tile;
    std::vector<float> rotated_input;
    std::shared_ptr<ProjectionWorkers> workers;
    bool rotated;
    bool reference_dot;
    bool exact_prefill; // Read once: getenv is too slow for every projection.
    explicit Math(std::shared_ptr<ProjectionWorkers> = {});
    // Row-major X[batch,in] times weights[out,in]. Output[batch,out].
    void project(const Tensor &, const float *, size_t, float *, size_t = 0, size_t = 0);
    void project_prepared(const Tensor &, const float *, size_t, float *, size_t = 0, size_t = 0);
    void prepare_input(const float *x, size_t cols, size_t padded, size_t batch, float *prepared_inputs);
};
void cq4_project(const Tensor &, const float *, size_t, float *, size_t, size_t,
                 std::vector<float> &, std::vector<float> &, ProjectionWorkers *, bool exact);
void cq4_prepare_input(const float *x, size_t cols, size_t padded, size_t batch,
                       float *inputs, float *scratch_rotated);
void cq4_project_prepared(const Tensor &t, const float *inputs, size_t batch, float *out,
                          size_t begin, size_t rows, std::vector<float> &tile,
                          ProjectionWorkers *workers, bool exact);
void fwht(float *, size_t);
void a8(float *, size_t);
void norm(const float *, float *, size_t, const float * = nullptr);
void softmax(float *, size_t);
bool sinkhorn_probabilities(float *, size_t);
void rope(float *, size_t, size_t, float);
void dense(const float *, const float *, float *, size_t, size_t, size_t);
// out[count][B cols] += (x[count][A cols] * A[layer]^T) * B[layer]; u holds count*rank floats.
void lora_add(const Tensor &, const Tensor &, size_t layer, const float *x, size_t count, float *out,
              float *u);
void kron(const float *, const Tensor &, const Tensor &, float *, float *);
void group_mix(const float *, const Tensor &, const Tensor &, float *, float *);
void attention_prefill(const float *, const float *, const float *, float *, float *,
                       size_t, size_t, size_t, size_t, size_t, size_t, size_t);
float sigmoid(float);
void sigmoid_multiply(float *, const float *, size_t, float *);
void finite(const float *, size_t);
struct Trace {
    np_trace_callback callback = nullptr;
    void *user = nullptr;
    void emit(int32_t layer, size_t pos, const char *label, int32_t head, const float *x,
              size_t n) const;
    void quant(int32_t layer, size_t pos, const char *label, int32_t head, const float *x,
               size_t n) const;
};
struct History {
    size_t rows, width;
    std::vector<float> data;
    History(size_t rows_, size_t width_) : rows(rows_), width(width_), data(rows_ * width_) {}
    void reset() { std::fill(data.begin(), data.end(), 0.f); }
    void convolve(const float *, float *, size_t pos, const Tensor &, size_t dilation,
                  size_t window);
};
struct KV {
    size_t window, heads, qdim, vdim;
    std::vector<int8_t> k, v;
    std::vector<float> ks, vs;
    KV(size_t, size_t, size_t, size_t);
    void put(size_t, const float *, const float *);
    // Decode attention for `group` A8 query heads sharing KV head `head` over
    // `count` ring entries from `first`. Scores needs group*count floats.
    void attend(size_t head, const float *queries, size_t group, size_t first, size_t count,
                float *scores, float *out, float scale) const;
};
// Online token softmax pooling: memory is independent of request length.
struct ConfidencePool {
    size_t rows, probes_per_row, queries, width;
    std::vector<float> probes, query, gain, bias, projection, maximum, mass, sums;
    float output_bias;
    explicit ConfidencePool(const Model &);
    void reset();
    void add(size_t, const float *);
    float score() const;
    size_t bytes() const;
};
// State after the first whole prefill chunks of a prompt, kept so the next request with the
// same leading tokens (usually the tool list) skips their prefill. Only used without fusion.
struct PrefixCache {
    size_t limit = 0, reused = 0;
    std::vector<int32_t> tokens, token_history;
    std::vector<KV> cache;
    std::vector<History> qhist, khist, vhist, ehist;
    std::unique_ptr<ConfidencePool> confidence;
};
struct Decoder {
    std::shared_ptr<Model> model;
    Math math;
    std::shared_ptr<FusionRequest> fusion;
    std::shared_ptr<RepresentationRequest> representation;
    std::unique_ptr<ConfidencePool> confidence;
    size_t position = 0, d, n, nh, nkh, qd, vd, win, hn, sites, block_capacity;
    std::vector<KV> cache;
    std::vector<History> qhist, khist, vhist, ehist;
    std::vector<int32_t> token_history;
    std::vector<uint32_t> p1, p2;
    std::vector<float> scratch, stream, memory, gathered, angles, last_hidden;
    PrefixCache prefix;
    size_t used = 0;
    // window 0 keeps the archive's KV window (header word 3).
    explicit Decoder(std::shared_ptr<Model>, std::shared_ptr<ProjectionWorkers> = {}, size_t window = 0);
    void reset();
    float *alloc(size_t);
    void run(const int32_t *, size_t, float *, float * = nullptr, Trace = {});
    void chunk(const int32_t *, size_t, float *, Trace);
    void engram(const int32_t *, size_t);
    void attention(size_t, size_t, const float *, float *, Trace);
    void monarch(const Layer &, const float *, float *, size_t count = 1);
    void save_prefix(const int32_t *, size_t);
    void restore_prefix();
};
} // namespace needle_cpu
struct np_handle {
    std::shared_ptr<needle_cpu::Model> model;
    size_t threads = 1, window = 0, prefix = 0;
    std::shared_ptr<needle_cpu::ProjectionWorkers> workers;
    std::unique_ptr<needle_cpu::Math> math;
    std::unique_ptr<needle_cpu::Decoder> decoder;
    std::shared_ptr<needle_cpu::FusionRequest> fusion;
    std::shared_ptr<needle_cpu::RepresentationRequest> representation;
    std::mutex mutex;
};
