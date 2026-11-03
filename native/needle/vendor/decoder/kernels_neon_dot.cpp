#include "neon_ops.h"
namespace needle_cpu {
struct NeonDotOps : NeonOps {
    using NeonOps::NeonOps;
    static Acc dot_acc(Acc acc,Bytes a,Bytes b) { return vdotq_s32(acc,a,b); }
};
const CpuKernels &neon_dot_kernels() {
    static const CpuKernels k{"neon-dot",kernel_project<NeonOps>,kernel_integer<NeonDotOps>,neon_decode,nullptr,nullptr};
    return k;
}
}
