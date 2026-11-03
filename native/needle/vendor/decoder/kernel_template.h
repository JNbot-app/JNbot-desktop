#pragma once
#include "internal.h"
#include "kernels.h"
#include <algorithm>
#include <cmath>

namespace needle_cpu {
// Four independent lanes and separate even/odd accumulators keep reductions
// identical across scalar, NEON, SSE2 and AVX2. Never contract multiply/add.
template<class Ops>
void kernel_project(const Tensor &t, const float *inputs, const float *weights,
                    size_t batch, size_t begin, size_t rows, float *out, size_t stride) {
    Ops book(t.book.data());
    const size_t groups = t.padded / 128, half = t.padded / 2;
    for (size_t r = 0; r < rows; r += 4) {
        const size_t nr = std::min(size_t(4), rows - r);
        for (size_t b = 0; b < batch; b += 2) {
            const size_t nb = std::min(size_t(2), batch - b);
            float sums[2][4]{};
            for (size_t g = 0; g < groups; ++g) {
                typename Ops::Vec acc[2][4]{};
                for (size_t k = 0; k < 64; k += 4) {
                    typename Ops::Vec activation[2];
                    for (size_t bi = 0; bi < nb; ++bi) {
                        const float *x = inputs + (b + bi) * t.padded + g * 64 + k;
                        activation[bi] = Ops::load(x, x + half);
                    }
                    for (size_t ri = 0; ri < nr; ++ri) {
                        typename Ops::Vec w;
                        if (weights) {
                            const float *p = weights + (r + ri) * t.padded + g * 64 + k;
                            w = Ops::load(p, p + half);
                        } else {
                            const uint8_t *p = t.data + (begin + r + ri) * half + g * 64 + k;
                            w = book.lookup(p);
                        }
                        for (size_t bi = 0; bi < nb; ++bi)
                            acc[bi][ri] = Ops::madd(acc[bi][ri], w, activation[bi]);
                    }
                }
                for (size_t bi = 0; bi < nb; ++bi)
                    for (size_t ri = 0; ri < nr; ++ri)
                        sums[bi][ri] += Ops::sum(acc[bi][ri]) * t.values[(begin + r + ri) * groups + g];
            }
            for (size_t bi = 0; bi < nb; ++bi)
                std::copy_n(sums[bi], nr, out + (b + bi) * stride + r);
        }
    }
}

// The legacy integer contract, but centroids are looked up from packed bytes.
// Activations are quantized once per projection, never once per output row.
// Lookups stay in registers and each 64-wide half group is reduced once; the
// integer sums and the float combination order match the reference exactly.
template<class Ops, size_t NR>
void integer_rows(const Tensor &t, const IntegerInput &input, const typename Ops::Table &table,
                  size_t row, float *out) {
    const size_t groups=t.padded/128,half=t.padded/2;
    const uint8_t *codes[NR];
    for(size_t ri=0;ri<NR;++ri) codes[ri]=t.data+(row+ri)*half;
    float sum[NR]{};
    for(size_t g=0;g<groups;++g) {
        typename Ops::Acc even[NR]{},odd[NR]{};
        for(size_t k=0;k<64;k+=16) {
            const auto ev=Ops::load_i8(input.activations+g*64+k),od=Ops::load_i8(input.activations+half+g*64+k);
            for(size_t ri=0;ri<NR;++ri) {
                typename Ops::Bytes low,high;
                Ops::lookup_i8(table,codes[ri]+g*64+k,low,high);
                even[ri]=Ops::dot_acc(even[ri],low,ev);
                odd[ri]=Ops::dot_acc(odd[ri],high,od);
            }
        }
        for(size_t ri=0;ri<NR;++ri) {
            float value=float(Ops::hsum(even[ri]))*input.scales[g*2]+float(Ops::hsum(odd[ri]))*input.scales[g*2+1];
            sum[ri]+=value*t.values[(row+ri)*groups+g];
        }
    }
    std::copy_n(sum,NR,out);
}
template<class Ops>
void kernel_integer(const Tensor &t, const IntegerInput &input, size_t begin,
                    size_t rows, float *out) {
    const auto table=Ops::table_i8(input.book);
    size_t r=0;
    for(;r+4<=rows;r+=4) integer_rows<Ops,4>(t,input,table,begin+r,out+r);
    for(;r<rows;++r) integer_rows<Ops,1>(t,input,table,begin+r,out+r);
}

template<class Ops>
void kernel_decode(const Tensor &t, size_t begin, size_t rows, float *weights, bool scaled) {
    Ops book(t.book.data());
    const size_t half = t.padded / 2, groups = t.padded / 128;
    for (size_t r = 0; r < rows; ++r)
        for (size_t g = 0; g < groups; ++g)
            for (size_t k = 0; k < 64; k += 4) {
                auto v = book.lookup(t.data + (begin + r) * half + g * 64 + k);
                if (scaled) v = Ops::scale(v, t.values[(begin + r) * groups + g]);
                float *p = weights + r * t.padded + g * 64 + k;
                Ops::store(p, p + half, v);
            }
}

template<class Ops>
void kernel_fwht(float *x) {
    for (size_t stride = 1; stride < 128; stride *= 2)
        for (size_t i = 0; i < 128; i += 2 * stride) {
            size_t j = 0;
            for (; j + 4 <= stride; j += 4)
                Ops::butterfly(x + i + j, x + i + j + stride);
            for (; j < stride; ++j) {
                float a = x[i + j], b = x[i + j + stride];
                x[i + j] = a + b;
                x[i + j + stride] = a - b;
            }
        }
    const double factor = 1.0 / std::sqrt(128.0);
    for (size_t i = 0; i < 128; ++i) x[i] = float(double(x[i]) * factor);
}
} // namespace needle_cpu
