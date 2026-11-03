#pragma once
#include <cstddef>
#include <cstdint>
namespace needle_cpu {
struct Tensor;
struct IntegerInput {
    const int8_t *activations;
    const float *scales;
    const int8_t *book;
};
struct CpuKernels {
    const char *name;
    void (*project)(const Tensor &, const float *, const float *, size_t, size_t, size_t, float *, size_t);
    void (*project_i8)(const Tensor &, const IntegerInput &, size_t, size_t, float *);
    void (*decode_tile)(const Tensor &, size_t, size_t, float *, bool);
    void (*fwht128)(float *);
    void (*quantize)(float *, size_t);
};
const CpuKernels &cpu_kernels();
const CpuKernels &scalar_kernels();
#if defined(NEEDLE_HAVE_NEON)
const CpuKernels &neon_kernels();
#endif
#if defined(NEEDLE_HAVE_NEON_DOT)
const CpuKernels &neon_dot_kernels();
#endif
#if defined(NEEDLE_HAVE_X86)
const CpuKernels &sse2_kernels();
const CpuKernels &avx2_kernels();
#endif
} // namespace needle_cpu
