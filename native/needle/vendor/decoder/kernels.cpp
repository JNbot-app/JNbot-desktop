#include "kernels.h"
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#if defined(NEEDLE_HAVE_NEON_DOT)
#if defined(__APPLE__)
#include <sys/sysctl.h>
#elif defined(__linux__)
#include <sys/auxv.h>
#include <asm/hwcap.h>
#endif
#endif
#if defined(NEEDLE_HAVE_X86)
#ifdef _MSC_VER
#include <intrin.h>
#else
#include <cpuid.h>
#endif
#endif
namespace needle_cpu {
#if defined(NEEDLE_HAVE_NEON_DOT)
static bool has_dotprod() {
#if defined(__APPLE__)
    int value=0;size_t bytes=sizeof(value);
    return sysctlbyname("hw.optional.arm.FEAT_DotProd",&value,&bytes,nullptr,0)==0 && value!=0;
#elif defined(__linux__) && defined(HWCAP_ASIMDDP)
    return (getauxval(AT_HWCAP)&HWCAP_ASIMDDP)!=0;
#else
    return false;
#endif
}
#endif
#if defined(NEEDLE_HAVE_X86)
static bool has_avx2(){
    unsigned a,b,c,d;
#ifdef _MSC_VER
    int regs[4];__cpuid(regs,0);if(regs[0]<7)return false;
    __cpuidex(regs,1,0);c=unsigned(regs[2]);
#else
    if(__get_cpuid_max(0,nullptr)<7 || !__get_cpuid(1,&a,&b,&c,&d))return false;
#endif
    if((c&((1u<<27)|(1u<<28)))!=((1u<<27)|(1u<<28)))return false;
#ifdef _MSC_VER
    if((_xgetbv(0)&6)!=6)return false;
    __cpuidex(regs,7,0);return (unsigned(regs[1])&(1u<<5))!=0;
#else
    unsigned lo,hi;__asm__ volatile("xgetbv":"=a"(lo),"=d"(hi):"c"(0));
    if((lo&6)!=6)return false;
    __cpuid_count(7,0,a,b,c,d);return (b&(1u<<5))!=0;
#endif
}
#endif
const CpuKernels &cpu_kernels(){
    static const CpuKernels *selected=[](){
        const char *name=std::getenv("NEEDLE_CPU_KERNEL");
        if(!name || std::strcmp(name,"auto")==0){
#if defined(NEEDLE_HAVE_NEON)
#if defined(NEEDLE_HAVE_NEON_DOT)
            if(has_dotprod())return &neon_dot_kernels();
#endif
            return &neon_kernels();
#elif defined(NEEDLE_HAVE_X86)
            return has_avx2()?&avx2_kernels():&sse2_kernels();
#else
            return &scalar_kernels();
#endif
        }
        if(std::strcmp(name,"scalar")==0)return &scalar_kernels();
#if defined(NEEDLE_HAVE_NEON_DOT)
        if(std::strcmp(name,"neon-dot")==0 && has_dotprod())return &neon_dot_kernels();
#endif
#if defined(NEEDLE_HAVE_NEON)
        if(std::strcmp(name,"neon")==0)return &neon_kernels();
#endif
#if defined(NEEDLE_HAVE_X86)
        if(std::strcmp(name,"sse2")==0)return &sse2_kernels();
        if(std::strcmp(name,"avx2")==0 && has_avx2())return &avx2_kernels();
#endif
        throw std::invalid_argument("Unavailable NEEDLE_CPU_KERNEL; use auto, scalar, neon, neon-dot, sse2 or avx2");
    }();
    return *selected;
}
} // namespace needle_cpu
