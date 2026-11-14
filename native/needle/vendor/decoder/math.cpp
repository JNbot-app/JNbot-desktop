#include "internal.h"
#include "kernels.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#else
#include <cblas.h>
#endif
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif

namespace needle_cpu {
Math::Math(std::shared_ptr<ProjectionWorkers> team)
    : tile(tile_bytes / sizeof(float)), workers(std::move(team)),
      rotated(std::getenv("NEEDLE_CPU_ROTATED") &&
              std::strcmp(std::getenv("NEEDLE_CPU_ROTATED"), "1") == 0),
      reference_dot(std::getenv("NEEDLE_CPU_REFERENCE_DOT") &&
                    std::strcmp(std::getenv("NEEDLE_CPU_REFERENCE_DOT"), "1") == 0),
      exact_prefill(std::getenv("NEEDLE_CPU_EXACT_PREFILL") &&
                    std::strcmp(std::getenv("NEEDLE_CPU_EXACT_PREFILL"), "1") == 0) {
    if (rotated)
        rotated_input.resize(batch_size * 32768);
}
void finite(const float *x, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (!std::isfinite(x[i]))
            throw std::invalid_argument("Non-finite numerical input");
}
void fwht(float *x, size_t n) {
    const auto &kernel = cpu_kernels();
    if (n == 128 && kernel.fwht128) {
        kernel.fwht128(x);
        return;
    }
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    if (n == 128) {
        float32x4_t v[32];
        for (int i = 0; i < 32; ++i)
            v[i] = vld1q_f32(x + i * 4);

        for (int i = 0; i < 32; ++i) {
            float32x4_t a = vtrn1q_f32(v[i], v[i]);
            float32x4_t b = vtrn2q_f32(v[i], v[i]);
            float32x4_t s = vaddq_f32(a, b);
            float32x4_t d = vsubq_f32(a, b);
            v[i] = vtrn1q_f32(s, d);
        }

        for (int i = 0; i < 32; ++i) {
            float32x4_t a = vcombine_f32(vget_low_f32(v[i]), vget_low_f32(v[i]));
            float32x4_t b = vcombine_f32(vget_high_f32(v[i]), vget_high_f32(v[i]));
            float32x4_t s = vaddq_f32(a, b);
            float32x4_t d = vsubq_f32(a, b);
            v[i] = vcombine_f32(vget_low_f32(s), vget_low_f32(d));
        }

        for (int i = 0; i < 32; i += 2) {
            float32x4_t a = v[i], b = v[i + 1];
            v[i] = vaddq_f32(a, b);
            v[i + 1] = vsubq_f32(a, b);
        }

        for (int i = 0; i < 32; i += 4) {
            for (int j = 0; j < 2; ++j) {
                float32x4_t a = v[i + j], b = v[i + 2 + j];
                v[i + j] = vaddq_f32(a, b);
                v[i + 2 + j] = vsubq_f32(a, b);
            }
        }

        for (int i = 0; i < 32; i += 8) {
            for (int j = 0; j < 4; ++j) {
                float32x4_t a = v[i + j], b = v[i + 4 + j];
                v[i + j] = vaddq_f32(a, b);
                v[i + 4 + j] = vsubq_f32(a, b);
            }
        }

        for (int i = 0; i < 32; i += 16) {
            for (int j = 0; j < 8; ++j) {
                float32x4_t a = v[i + j], b = v[i + 8 + j];
                v[i + j] = vaddq_f32(a, b);
                v[i + 8 + j] = vsubq_f32(a, b);
            }
        }

        for (int j = 0; j < 16; ++j) {
            float32x4_t a = v[j], b = v[16 + j];
            v[j] = vaddq_f32(a, b);
            v[16 + j] = vsubq_f32(a, b);
        }

        const double inv_denominator = 1.0 / std::sqrt(128.0);
        for (int i = 0; i < 32; ++i) {
            float buf[4];
            vst1q_f32(buf, v[i]);
            for (int k = 0; k < 4; ++k)
                x[i * 4 + k] = float(double(buf[k]) * inv_denominator);
        }
        return;
    }
#endif
    for (size_t stride = 1; stride < n; stride *= 2)
        for (size_t i = 0; i < n; i += 2 * stride)
            for (size_t j = 0; j < stride; ++j) {
                float a = x[i + j], b = x[i + j + stride];
                x[i + j] = a + b;
                x[i + j + stride] = a - b;
            }
    const double inv_denominator = 1.0 / std::sqrt(double(n));
    for (size_t i = 0; i < n; ++i)
        x[i] = float(double(x[i]) * inv_denominator);
}
float sigmoid(float x) { return 1.f / (1.f + std::exp(-x)); }
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
// Cephes single-precision exp, clamped to [-87.3, 88.3] so 2^n stays a normal float.
static inline float32x4_t neon_exp(float32x4_t x) {
    x = vminq_f32(vmaxq_f32(x, vdupq_n_f32(-87.3f)), vdupq_n_f32(88.3f));
    const float32x4_t n = vrndnq_f32(vmulq_n_f32(x, 1.44269504088896341f));
    float32x4_t r = vfmsq_f32(x, n, vdupq_n_f32(0.693359375f));
    r = vfmsq_f32(r, n, vdupq_n_f32(-2.12194440e-4f));
    float32x4_t p = vdupq_n_f32(1.9875691500e-4f);
    p = vfmaq_f32(vdupq_n_f32(1.3981999507e-3f), p, r);
    p = vfmaq_f32(vdupq_n_f32(8.3334519073e-3f), p, r);
    p = vfmaq_f32(vdupq_n_f32(4.1665795894e-2f), p, r);
    p = vfmaq_f32(vdupq_n_f32(1.6666665459e-1f), p, r);
    p = vfmaq_f32(vdupq_n_f32(5.0000001201e-1f), p, r);
    p = vfmaq_f32(vaddq_f32(r, vdupq_n_f32(1.f)), p, vmulq_f32(r, r));
    const int32x4_t exponent = vshlq_n_s32(vaddq_s32(vcvtq_s32_f32(n), vdupq_n_s32(127)), 23);
    return vmulq_f32(p, vreinterpretq_f32_s32(exponent));
}
#endif
static void vector_exp(float *x, size_t n) {
    size_t i = 0;
#ifdef __APPLE__
    if (n >= 16) {
        const int count = int(n);
        vvexpf(x, x, &count);
        return;
    }
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
    for (; i + 4 <= n; i += 4)
        vst1q_f32(x + i, neon_exp(vld1q_f32(x + i)));
#endif
    for (; i < n; ++i)
        x[i] = std::exp(x[i]);
}
void sigmoid_multiply(float *values, const float *gates, size_t n, float *temporary) {
    for (size_t i = 0; i < n; ++i)
        temporary[i] = -gates[i];
    vector_exp(temporary, n);
    for (size_t i = 0; i < n; ++i)
        values[i] *= 1.f / (1.f + temporary[i]);
}
void a8(float *x, size_t n) {
    const auto &kernel = cpu_kernels();
    if (kernel.quantize) {
        kernel.quantize(x, n);
        return;
    }
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    float32x4_t v_max = vdupq_n_f32(0.f);
    size_t i = 0;
    for (; i + 4 <= n; i += 4) {
        float32x4_t v = vabsq_f32(vld1q_f32(x + i));
        v_max = vmaxq_f32(v_max, v);
    }
    float maximum = vmaxvq_f32(v_max);
    for (; i < n; ++i)
        maximum = std::max(maximum, std::abs(x[i]));

    float scale = maximum > 0 ? maximum * (1.f / 127.f) : 1.f;
    float inv_scale = 1.f / scale;
    float32x4_t v_inv_scale = vdupq_n_f32(inv_scale);
    float32x4_t v_scale = vdupq_n_f32(scale);
    float32x4_t v_min = vdupq_n_f32(-128.f);
    float32x4_t v_top = vdupq_n_f32(127.f);

    i = 0;
    for (; i + 4 <= n; i += 4) {
        float32x4_t v = vld1q_f32(x + i);
        float32x4_t scaled = vmulq_f32(v, v_inv_scale);
        float32x4_t rounded = vrndnq_f32(scaled);
        float32x4_t clamped = vminq_f32(v_top, vmaxq_f32(v_min, rounded));
        vst1q_f32(x + i, vmulq_f32(clamped, v_scale));
    }
    for (; i < n; ++i)
        x[i] = std::max(-128.f, std::min(127.f, std::nearbyint(x[i] / scale))) * scale;
#else
    float maximum = 0;
    for (size_t i = 0; i < n; ++i)
        maximum = std::max(maximum, std::abs(x[i]));
    float scale = maximum > 0 ? maximum * (1.f / 127.f) : 1.f;
    for (size_t i = 0; i < n; ++i)
        x[i] = std::max(-128.f, std::min(127.f, std::nearbyint(x[i] / scale))) * scale;
#endif
}
void norm(const float *x, float *y, size_t n, const float *scale) {
    if (!n || n > 32768)
        throw std::invalid_argument("RMS width outside workspace");
    size_t i = 0;
    float sum = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    float32x4_t a = vdupq_n_f32(0.f), b = vdupq_n_f32(0.f);
    for (; i + 8 <= n; i += 8) {
        const float32x4_t u = vld1q_f32(x + i), v = vld1q_f32(x + i + 4);
        a = vfmaq_f32(a, u, u);
        b = vfmaq_f32(b, v, v);
    }
    sum = vaddvq_f32(vaddq_f32(a, b));
#else
    float sums[4]{};
    for (; i + 4 <= n; i += 4)
        for (size_t lane = 0; lane < 4; ++lane)
            sums[lane] += x[i+lane] * x[i+lane];
    sum = (sums[0] + sums[1]) + (sums[2] + sums[3]);
#endif
    for (; i < n; ++i) sum += x[i] * x[i];
    const float inverse = 1.f / std::sqrt(sum * (1.f / float(n)) + 1e-6f);
    i = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    const float32x4_t s = vdupq_n_f32(inverse), one = vdupq_n_f32(1.f);
    for (; i + 4 <= n; i += 4) {
        float32x4_t v = vmulq_f32(vld1q_f32(x + i), s);
        if (scale) v = vmulq_f32(v, vaddq_f32(one, vld1q_f32(scale + i)));
        vst1q_f32(y + i, v);
    }
#endif
    for (; i < n; ++i)
        y[i] = scale ? (1.f + scale[i]) * (x[i] * inverse) : x[i] * inverse;
}
void softmax(float *x, size_t n) {
    size_t i = 0;
    float maximum = x[0], sum = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    if (n >= 4) {
        float32x4_t m = vld1q_f32(x);
        for (i = 4; i + 4 <= n; i += 4) m = vmaxq_f32(m, vld1q_f32(x + i));
        maximum = vmaxvq_f32(m);
        for (; i < n; ++i) maximum = std::max(maximum, x[i]);
        const float32x4_t top = vdupq_n_f32(maximum);
        float32x4_t total = vdupq_n_f32(0.f);
        for (i = 0; i + 4 <= n; i += 4) {
            const float32x4_t e = neon_exp(vsubq_f32(vld1q_f32(x + i), top));
            vst1q_f32(x + i, e);
            total = vaddq_f32(total, e);
        }
        sum = vaddvq_f32(total);
    }
#endif
    if (!i) {
        maximum = *std::max_element(x, x + n);
        for (size_t j = 0; j < n; ++j) x[j] -= maximum;
        vector_exp(x, n);
        for (; i < n; ++i) sum += x[i];
    }
    for (; i < n; ++i) {
        x[i] = std::exp(x[i] - maximum);
        sum += x[i];
    }
    const float inverse = 1.f / sum;
    for (i = 0; i < n; ++i)
        x[i] *= inverse;
}
bool sinkhorn_probabilities(float *x, size_t n) {
    const auto range = std::minmax_element(x, x + n*n);
    const float maximum = *range.second;
    // Retain the log-space path for extreme logits that could underflow.
    if (maximum - *range.first > 80.f) return false;
    for (size_t i = 0; i < n*n; ++i) x[i] = std::exp(x[i] - maximum);
    for (int iteration = 0; iteration < 20; ++iteration)
        for (int axis = 0; axis < 2; ++axis)
            for (size_t row = 0; row < n; ++row) {
                float sum = 0.f;
                for (size_t col = 0; col < n; ++col)
                    sum += x[axis ? col*n+row : row*n+col];
                const float inverse = 1.f / sum;
                for (size_t col = 0; col < n; ++col)
                    x[axis ? col*n+row : row*n+col] *= inverse;
            }
    return true;
}
void rope(float *x, size_t n, size_t position, float theta) {
    for (size_t j = 0; j < n / 2; ++j) {
        float angle = float(position) * (1.f / std::pow(theta, float(2 * j) / float(n)));
        float c = std::cos(angle), s = std::sin(angle), a = x[j], b = x[j + n / 2];
        x[j] = a * c - b * s;
        x[j + n / 2] = b * c + a * s;
    }
}
void dense(const float *a, const float *b, float *out, size_t m, size_t k, size_t n) {
    cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, int(m), int(n), int(k), 1.f, a, int(k),
                b, int(n), 0.f, out, int(n));
}
// Dot product of an FP16 (ARM) or FP32 weight row with an FP32 vector.
static float factor_dot(const factor_t *w, const float *x, size_t n) {
    size_t i = 0;
    float sum = 0.f;
#if defined(__aarch64__)
    float32x4_t a0 = vdupq_n_f32(0.f), a1 = a0, a2 = a0, a3 = a0;
    for (; i + 16 <= n; i += 16) {
        float16x8_t h0 = vld1q_f16(reinterpret_cast<const float16_t *>(w + i));
        float16x8_t h1 = vld1q_f16(reinterpret_cast<const float16_t *>(w + i + 8));
        a0 = vfmaq_f32(a0, vcvt_f32_f16(vget_low_f16(h0)), vld1q_f32(x + i));
        a1 = vfmaq_f32(a1, vcvt_high_f32_f16(h0), vld1q_f32(x + i + 4));
        a2 = vfmaq_f32(a2, vcvt_f32_f16(vget_low_f16(h1)), vld1q_f32(x + i + 8));
        a3 = vfmaq_f32(a3, vcvt_high_f32_f16(h1), vld1q_f32(x + i + 12));
    }
    sum = vaddvq_f32(vaddq_f32(vaddq_f32(a0, a1), vaddq_f32(a2, a3)));
#endif
    for (; i < n; ++i)
        sum += float(w[i]) * x[i];
    return sum;
}
void lora_add(const Tensor &a, const Tensor &b, size_t layer, const float *x, size_t count, float *out,
              float *u) {
    // FP16 rows read straight from the archive on ARM (see factor_t): half the memory traffic.
    const size_t rank = a.shape[1], in = a.shape[2], width = b.shape[2];
    const factor_t *A = a.factors() + layer * rank * in, *B = b.factors() + layer * rank * width;
    for (size_t t = 0; t < count; ++t) {
        const float *input = x + t * in;
        float *low = u + t * rank, *output = out + t * width;
        for (size_t k = 0; k < rank; ++k)
            low[k] = factor_dot(A + k * in, input, in);
        for (size_t k = 0; k < rank; ++k) { // output += low[k] * B[k]
            const factor_t *row = B + k * width;
            const float scale = low[k];
            size_t i = 0;
#if defined(__aarch64__)
            for (; i + 8 <= width; i += 8) {
                float16x8_t h = vld1q_f16(reinterpret_cast<const float16_t *>(row + i));
                vst1q_f32(output + i, vfmaq_n_f32(vld1q_f32(output + i), vcvt_f32_f16(vget_low_f16(h)), scale));
                vst1q_f32(output + i + 4, vfmaq_n_f32(vld1q_f32(output + i + 4), vcvt_high_f32_f16(h), scale));
            }
#endif
            for (; i < width; ++i)
                output[i] += scale * float(row[i]);
        }
    }
}
void kron(const float *x, const Tensor &a, const Tensor &b, float *out, float *temporary) {
    int na = int(a.shape[0]), nb = int(b.shape[0]);
    cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, na, nb, na, 1.f, a.floats(), na, x, nb,
                0.f, temporary, nb);
    dense(temporary, b.floats(), out, size_t(na), size_t(nb), size_t(nb));
}
// Monarch mixing of x viewed as [na][nb]: row i is mixed by its own b[i] ([na][nb][nb]),
// then column l by its own a[l] ([nb][na][na]). Same multiply count as kron. Groups are
// small, so register-held loops beat per-group BLAS calls; N fixes the group size at
// compile time so each running sum stays in vector registers.
template <size_t N>
static void group_mix_fixed(const float *x, const factor_t *fa, const factor_t *fb, float *out,
                            float *temporary) {
    for (size_t i = 0; i < N; ++i) {
        float sum[N] = {};
        for (size_t j = 0; j < N; ++j) {
            const float v = x[i * N + j];
            const factor_t *weights = fb + (i * N + j) * N;
            for (size_t k = 0; k < N; ++k)
                sum[k] += v * float(weights[k]);
        }
        std::copy(sum, sum + N, temporary + i * N);
    }
    for (size_t l = 0; l < N; ++l) {
        float sum[N] = {};
        for (size_t i = 0; i < N; ++i) {
            const float v = temporary[i * N + l];
            const factor_t *weights = fa + (l * N + i) * N;
            for (size_t k = 0; k < N; ++k)
                sum[k] += v * float(weights[k]);
        }
        for (size_t k = 0; k < N; ++k)
            out[k * N + l] = sum[k];
    }
}
void group_mix(const float *x, const Tensor &a, const Tensor &b, float *out, float *temporary) {
    const size_t na = b.shape[0], nb = b.shape[1];
    const factor_t *fa = a.factors(), *fb = b.factors();
    if (na == 32 && nb == 32)
        return group_mix_fixed<32>(x, fa, fb, out, temporary);
    for (size_t i = 0; i < na; ++i) {
        float *row = temporary + i * nb;
        std::fill(row, row + nb, 0.f);
        for (size_t j = 0; j < nb; ++j) {
            const float v = x[i * nb + j];
            const factor_t *weights = fb + (i * nb + j) * nb;
            for (size_t k = 0; k < nb; ++k)
                row[k] += v * float(weights[k]);
        }
    }
    float column[64];
    for (size_t l = 0; l < nb; ++l) {
        std::fill(column, column + na, 0.f);
        for (size_t i = 0; i < na; ++i) {
            const float v = temporary[i * nb + l];
            const factor_t *weights = fa + (l * na + i) * na;
            for (size_t k = 0; k < na; ++k)
                column[k] += v * float(weights[k]);
        }
        for (size_t k = 0; k < na; ++k)
            out[k * nb + l] = column[k];
    }
}
void attention_prefill(const float *queries, const float *keys, const float *values,
                       float *scores, float *out, size_t count, size_t previous,
                       size_t window, size_t heads, size_t kv_heads, size_t qdim, size_t vdim) {
    const size_t entries = previous + count;
    const float scale = 1.f / std::sqrt(float(qdim));
    for (size_t h = 0; h < heads; ++h) {
        const size_t kh = h / (heads / kv_heads);
        {
            ProfileTimer timer(PHASE_ATTN_SCORES);
            cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasTrans,
                        int(count), int(entries), int(qdim), scale,
                        queries + h * qdim, int(heads * qdim),
                        keys + kh * entries * qdim, int(qdim), 0.f, scores, int(entries));
        }
        {
            ProfileTimer timer(PHASE_ATTN_SOFTMAX);
            for (size_t t = 0; t < count; ++t) {
                const size_t end = previous + t + 1;
                const size_t begin = end > window ? end - window : 0;
                float *row = scores + t * entries;
                softmax(row + begin, end - begin);
                std::fill(row, row + begin, 0.f);
                std::fill(row + end, row + entries, 0.f);
            }
        }
        {
            ProfileTimer timer(PHASE_ATTN_VALUES);
            cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans,
                        int(count), int(vdim), int(entries), 1.f, scores, int(entries),
                        values + kh * entries * vdim, int(vdim), 0.f,
                        out + h * vdim, int(heads * vdim));
        }
    }
}
void Math::project(const Tensor &t, const float *x, size_t batch, float *out, size_t begin,
                   size_t rows) {
    if (t.ndim != 2 || t.kind > 3)
        throw std::invalid_argument("Expected projection matrix");
    if (!rows)
        rows = t.shape[0];
    size_t cols = t.shape[1];
    if (!batch || batch > batch_size || begin > t.shape[0] || rows > t.shape[0] - begin ||
        cols > 32768 || !rows || rows > 65536)
        throw std::invalid_argument("Matrix-vector exceeds workspace capacity");
    bool rotate = rotated && t.kind == 3;
    if (t.kind == 3 && t.bits == 4 && t.group == 128 && !rotate && !reference_dot) {
        cq4_project(t, x, batch, out, begin, rows, rotated_input, tile, workers.get(), exact_prefill);
        return;
    }
    size_t logical_cols = cols;
    if (rotate) {
        cols = t.padded;
        for (size_t b = 0; b < batch; ++b) {
            float *row = rotated_input.data() + b * cols;
            std::copy_n(x + b * logical_cols, logical_cols, row);
            std::fill(row + logical_cols, row + cols, 0.f);
            for (size_t g = 0; g < cols; g += t.group)
                fwht(row + g, t.group);
        }
        x = rotated_input.data();
    }
    {
        ProfileTimer timer_gemm(PHASE_MATH_FALLBACK_GEMM);
        size_t tile_rows = tile.size() / cols;
        for (size_t start = 0; start < rows; start += tile_rows) {
            size_t count = std::min(tile_rows, rows - start);
            for (size_t r = 0; r < count; ++r)
                t.row(begin + start + r, tile.data() + r * cols, rotate);
            if (reference_dot) {
                std::array<float, 32768> products;
                size_t padded = 1;
                while (padded < cols)
                    padded *= 2;
                for (size_t b = 0; b < batch; ++b)
                    for (size_t r = 0; r < count; ++r) {
                        for (size_t i = 0; i < cols; ++i)
                            products[i] = tile[r * cols + i] * x[b * cols + i];
                        std::fill(products.begin() + cols, products.begin() + padded, 0.f);
                        for (size_t stride = padded / 2; stride; stride /= 2)
                            for (size_t i = 0; i < stride; ++i)
                                products[i] += products[i + stride];
                        out[b * rows + start + r] = products[0];
                    }
            } else if (batch == 1)
                cblas_sgemv(CblasRowMajor, CblasNoTrans, int(count), int(cols), 1.f, tile.data(),
                            int(cols), x, 1, 0.f, out + start, 1);
            else
                cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasTrans, int(batch), int(count), int(cols),
                            1.f, x, int(cols), tile.data(), int(cols), 0.f, out + start, int(rows));
        }
    }
}
void Math::prepare_input(const float *x, size_t cols, size_t padded, size_t batch, float *prepared_inputs) {
    rotated_input.resize(std::max(size_t(8192), (batch + 1) * padded));
    float *rotated = rotated_input.data();
    cq4_prepare_input(x, cols, padded, batch, prepared_inputs, rotated);
}
void Math::project_prepared(const Tensor &t, const float *inputs, size_t batch, float *out, size_t begin,
                            size_t rows) {
    if (t.ndim != 2 || t.kind > 3)
        throw std::invalid_argument("Expected projection matrix");
    if (!rows)
        rows = t.shape[0];
    size_t cols = t.shape[1];
    if (!batch || batch > batch_size || begin > t.shape[0] || rows > t.shape[0] - begin ||
        cols > 32768 || !rows || rows > 65536)
        throw std::invalid_argument("Matrix-vector exceeds workspace capacity");
    bool rotate = rotated && t.kind == 3;
    if (t.kind == 3 && t.bits == 4 && t.group == 128 && !rotate && !reference_dot) {
        cq4_project_prepared(t, inputs, batch, out, begin, rows, tile, workers.get(), exact_prefill);
        return;
    }
    project(t, inputs, batch, out, begin, rows);
}
void Trace::emit(int32_t layer, size_t pos, const char *label, int32_t head, const float *x,
                 size_t n) const {
    if (callback && callback(user, layer, uint32_t(pos), label, head, x, n))
        throw std::runtime_error("Diagnostic trace callback stopped inference");
}
void Trace::quant(int32_t layer, size_t pos, const char *label, int32_t head, const float *x,
                  size_t n) const {
    if (!callback)
        return;
    float maximum = 0;
    for (size_t i = 0; i < n; ++i)
        maximum = std::max(maximum, std::abs(x[i]));
    float scale = maximum > 0 ? maximum * (1.f / 127.f) : 1.f;
    std::vector<float> codes(n), values(n);
    for (size_t i = 0; i < n; ++i) {
        codes[i] = std::max(-128.f, std::min(127.f, std::nearbyint(x[i] / scale)));
        values[i] = codes[i] * scale;
    }
    std::string prefix(label);
    emit(layer, pos, (prefix + ".input").c_str(), head, x, n);
    emit(layer, pos, (prefix + ".scale").c_str(), head, &scale, 1);
    emit(layer, pos, (prefix + ".codes").c_str(), head, codes.data(), n);
    emit(layer, pos, (prefix + ".reconstructed").c_str(), head, values.data(), n);
}
void History::convolve(const float *raw, float *out, size_t pos, const Tensor &taps,
                       size_t dilation, size_t window) {
    if (!rows) {
        std::copy_n(raw, width, out);
        return;
    }
    std::copy_n(raw, width, data.data() + (pos % rows) * width);
    size_t count = std::min(size_t(taps.shape[0]), pos / dilation + 1);
    if (dilation == 1 && taps.shape[0] == 3 && window >= 3 && count >= 2) {
        const float *taps_p = taps.floats();
        const float *t0 = taps_p;
        const float *t1 = taps_p + width;
        const float *t2 = taps_p + 2 * width;
        const float *d0 = data.data() + ((pos % rows) * width);
        const float *d1 = data.data() + (((pos - 1) % rows) * width);
        const float *d2 = data.data() + (((pos - 2) % rows) * width);
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
        size_t i = 0;
        for (; i + 4 <= width; i += 4) {
            float32x4_t previous = vmulq_f32(vld1q_f32(t1 + i), vld1q_f32(d1 + i));
            float32x4_t sum = vfmaq_f32(previous, vld1q_f32(t0 + i), vld1q_f32(d0 + i));
            if (count == 3)
                sum = vfmaq_f32(sum, vld1q_f32(t2 + i), vld1q_f32(d2 + i));
            vst1q_f32(out + i, sum);
        }
        for (; i < width; ++i) {
            float previous = t1[i] * d1[i];
            float sum = std::fma(t0[i], d0[i], previous);
            if (count == 3)
                sum = std::fma(t2[i], d2[i], sum);
            out[i] = sum;
        }
#else
        for (size_t i = 0; i < width; ++i) {
            float previous = t1[i] * d1[i];
            float sum = std::fma(t0[i], d0[i], previous);
            if (count == 3)
                sum = std::fma(t2[i], d2[i], sum);
            out[i] = sum;
        }
#endif
        return;
    }
    if (taps.kind <= 2) {
        std::fill_n(out, width, 0.f);
        for (size_t j = 0; j < count; ++j) {
            if (j * dilation >= window) continue;
            const float *tap = taps.floats() + j * width;
            const float *past = data.data() + ((pos - j * dilation) % rows) * width;
            for (size_t i = 0; i < width; ++i) out[i] += tap[i] * past[i];
        }
        return;
    }
    for (size_t i = 0; i < width; ++i) {
        float sum = 0;
        for (size_t j = 0; j < count; ++j)
            if (j * dilation < window)
                sum += taps.scalar(j * width + i) *
                       data[((pos - j * dilation) % rows) * width + i];
        out[i] = sum;
    }
}
KV::KV(size_t w, size_t h, size_t q, size_t value)
    : window(w), heads(h), qdim(q), vdim(value), k(w * h * q), v(w * h * value), ks(w * h), vs(w * h) {}
// Recovers the integer codes of an A8-quantized vector: its largest magnitude is 127 codes.
static float a8_codes(const float *x, size_t n, int8_t *codes) {
    float maximum = 0;
    for (size_t i = 0; i < n; ++i) maximum = std::max(maximum, std::abs(x[i]));
    const float scale = maximum > 0 ? maximum * (1.f / 127.f) : 1.f, inverse = 1.f / scale;
    for (size_t i = 0; i < n; ++i)
        codes[i] = int8_t(std::max(-128.f, std::min(127.f, std::nearbyint(x[i] * inverse))));
    return scale;
}
void KV::attend(size_t head, const float *queries, size_t group, size_t first, size_t count,
                float *scores, float *out, float scale) const {
    // All query heads that share this KV head read each cached row once.
    constexpr size_t max_group = 16, max_qdim = 256;
    if (group > max_group || qdim > max_qdim)
        throw std::invalid_argument("Attention group exceeds decode workspace");
    int8_t q[max_group * max_qdim];
    float qscale[max_group];
    for (size_t g = 0; g < group; ++g)
        qscale[g] = a8_codes(queries + g * qdim, qdim, q + g * qdim) * scale;
    {
        ProfileTimer timer(PHASE_ATTN_SCORES);
        for (size_t j = 0; j < count; ++j) {
            const size_t row = ((first + j) % window) * heads + head;
            const int8_t *key = k.data() + row * qdim;
            for (size_t g = 0; g < group; ++g) {
                const int8_t *qg = q + g * qdim;
                int32_t dot = 0;
                size_t i = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
                int32x4_t acc = vdupq_n_s32(0);
                for (; i + 16 <= qdim; i += 16) {
                    const int8x16_t a = vld1q_s8(key + i), b = vld1q_s8(qg + i);
                    acc = vpadalq_s16(acc, vmull_s8(vget_low_s8(a), vget_low_s8(b)));
                    acc = vpadalq_s16(acc, vmull_high_s8(a, b));
                }
                dot = vaddvq_s32(acc);
#endif
                for (; i < qdim; ++i) dot += int32_t(key[i]) * qg[i];
                scores[g * count + j] = float(dot) * (qscale[g] * ks[row]);
            }
        }
    }
    {
        ProfileTimer timer(PHASE_ATTN_SOFTMAX);
        for (size_t g = 0; g < group; ++g) {
            float *p = scores + g * count;
            softmax(p, count);
            for (size_t j = 0; j < count; ++j) p[j] *= vs[((first + j) % window) * heads + head];
        }
    }
    ProfileTimer timer(PHASE_ATTN_VALUES);
    std::fill_n(out, group * vdim, 0.f);
    size_t i = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
    // Sixteen value columns at a time keep every head's accumulator in registers.
    if (group <= 6)
        for (; i + 16 <= vdim; i += 16) {
            float32x4_t acc[6][4];
            for (size_t g = 0; g < 6; ++g)
                for (size_t c = 0; c < 4; ++c) acc[g][c] = vdupq_n_f32(0.f);
            for (size_t j = 0; j < count; ++j) {
                const size_t row = ((first + j) % window) * heads + head;
                const int8x16_t codes = vld1q_s8(v.data() + row * vdim + i);
                const int16x8_t low = vmovl_s8(vget_low_s8(codes)), high = vmovl_high_s8(codes);
                const float32x4_t value[4] = {vcvtq_f32_s32(vmovl_s16(vget_low_s16(low))),
                                              vcvtq_f32_s32(vmovl_high_s16(low)),
                                              vcvtq_f32_s32(vmovl_s16(vget_low_s16(high))),
                                              vcvtq_f32_s32(vmovl_high_s16(high))};
                for (size_t g = 0; g < group; ++g) {
                    const float factor = scores[g * count + j];
                    for (size_t c = 0; c < 4; ++c) acc[g][c] = vfmaq_n_f32(acc[g][c], value[c], factor);
                }
            }
            for (size_t g = 0; g < group; ++g)
                for (size_t c = 0; c < 4; ++c) vst1q_f32(out + g * vdim + i + c * 4, acc[g][c]);
        }
#endif
    for (size_t j = 0; j < count && i < vdim; ++j) {
        const size_t row = ((first + j) % window) * heads + head;
        const int8_t *value = v.data() + row * vdim;
        for (size_t g = 0; g < group; ++g) {
            const float factor = scores[g * count + j];
            for (size_t c = i; c < vdim; ++c) out[g * vdim + c] += factor * float(value[c]);
        }
    }
}
void KV::put(size_t pos, const float *key, const float *value) {
    size_t slot = pos % window;
    for (size_t h = 0; h < heads; ++h) {
        auto quant = [&](const float *x, size_t width, int8_t *codes, float &scale) {
            float maximum = 0;
            for (size_t i = 0; i < width; ++i)
                maximum = std::max(maximum, std::abs(x[i]));
            scale = maximum > 0 ? maximum * (1.f / 127.f) : 1.f;
            for (size_t i = 0; i < width; ++i)
                codes[i] = int8_t(std::max(-128.f, std::min(127.f, std::nearbyint(x[i] / scale))));
        };
        quant(key + h * qdim, qdim, k.data() + (slot * heads + h) * qdim, ks[slot * heads + h]);
        quant(value + h * vdim, vdim, v.data() + (slot * heads + h) * vdim, vs[slot * heads + h]);
    }
}
} // namespace needle_cpu
