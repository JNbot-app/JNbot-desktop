#include "kernel_template.h"
namespace needle_cpu {
struct ScalarOps {
    struct Vec { float lo[4]{}, hi[4]{}; };
    const float *book;
    explicit ScalarOps(const float *p) : book(p) {}
    Vec lookup(const uint8_t *p) const {
        Vec v;
        for (size_t i = 0; i < 4; ++i) { v.lo[i] = book[p[i] & 15]; v.hi[i] = book[p[i] >> 4]; }
        return v;
    }
    static Vec load(const float *a, const float *b) {
        Vec v; std::copy_n(a, 4, v.lo); std::copy_n(b, 4, v.hi); return v;
    }
    static void store(float *a, float *b, Vec v) { std::copy_n(v.lo, 4, a); std::copy_n(v.hi, 4, b); }
    static Vec madd(Vec a, Vec w, Vec x) {
        for (size_t i = 0; i < 4; ++i) { a.lo[i] += w.lo[i] * x.lo[i]; a.hi[i] += w.hi[i] * x.hi[i]; }
        return a;
    }
    static Vec scale(Vec v, float s) { for (size_t i=0;i<4;++i) { v.lo[i]*=s; v.hi[i]*=s; } return v; }
    static float sum(Vec v) {
        float a[4]; for (size_t i=0;i<4;++i) a[i]=v.lo[i]+v.hi[i];
        return (a[0]+a[1])+(a[2]+a[3]);
    }
    using Table=const int8_t *; struct Bytes { int8_t v[16]; }; using Acc=int32_t;
    static Table table_i8(const int8_t *book) { return book; }
    static Bytes load_i8(const int8_t *p) { Bytes b; std::copy_n(p,16,b.v); return b; }
    static void lookup_i8(Table book,const uint8_t *p,Bytes &lo,Bytes &hi) {
        for(size_t i=0;i<16;++i){lo.v[i]=book[p[i]&15];hi.v[i]=book[p[i]>>4];}
    }
    static Acc dot_acc(Acc acc,const Bytes &a,const Bytes &b) {
        for(size_t i=0;i<16;++i)acc+=int32_t(a.v[i])*b.v[i];return acc;
    }
    static int32_t hsum(Acc acc) { return acc; }
    static void butterfly(float *a, float *b) {
        for (size_t i=0;i<4;++i) { float x=a[i], y=b[i]; a[i]=x+y; b[i]=x-y; }
    }
};
static void scalar_a8(float *x, size_t n) {
    float maximum=0.f;
    for(size_t i=0;i<n;++i) maximum=std::max(maximum,std::abs(x[i]));
    const float scale=maximum>0 ? maximum*(1.f/127.f) : 1.f, inv=1.f/scale;
    size_t i=0;
    for(;i+4<=n;i+=4)
        for(size_t j=0;j<4;++j) x[i+j]=std::max(-128.f,std::min(127.f,std::nearbyint(x[i+j]*inv)))*scale;
    for(;i<n;++i) x[i]=std::max(-128.f,std::min(127.f,std::nearbyint(x[i]/scale)))*scale;
}
const CpuKernels &scalar_kernels() {
    static const CpuKernels k{"scalar",kernel_project<ScalarOps>,kernel_integer<ScalarOps>,kernel_decode<ScalarOps>,kernel_fwht<ScalarOps>,scalar_a8};
    return k;
}
} // namespace needle_cpu
