#include "neon_ops.h"
namespace needle_cpu {
const CpuKernels &neon_kernels() {
    // math.cpp retains the register-resident NEON FWHT and quantization kernels.
    static const CpuKernels k{"neon",kernel_project<NeonOps>,kernel_integer<NeonOps>,neon_decode,nullptr,nullptr};
    return k;
}
} // namespace needle_cpu
