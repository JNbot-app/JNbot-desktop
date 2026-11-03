#include "kernel_template.h"
#include <emmintrin.h>
namespace needle_cpu {
struct SseOps {
    struct Vec { __m128 lo{},hi{}; };
    const float *book;
    explicit SseOps(const float *p):book(p){}
    Vec lookup(const uint8_t *p) const {
        return {_mm_set_ps(book[p[3]&15],book[p[2]&15],book[p[1]&15],book[p[0]&15]),
                _mm_set_ps(book[p[3]>>4],book[p[2]>>4],book[p[1]>>4],book[p[0]>>4])};
    }
    static Vec load(const float *a,const float *b) { return {_mm_loadu_ps(a),_mm_loadu_ps(b)}; }
    static void store(float *a,float *b,Vec v) { _mm_storeu_ps(a,v.lo);_mm_storeu_ps(b,v.hi); }
    static Vec madd(Vec a,Vec w,Vec x) { return {_mm_add_ps(a.lo,_mm_mul_ps(w.lo,x.lo)),_mm_add_ps(a.hi,_mm_mul_ps(w.hi,x.hi))}; }
    static Vec scale(Vec v,float s) { auto z=_mm_set1_ps(s);return {_mm_mul_ps(v.lo,z),_mm_mul_ps(v.hi,z)}; }
    static float sum(Vec v) { float a[4];_mm_storeu_ps(a,_mm_add_ps(v.lo,v.hi));return (a[0]+a[1])+(a[2]+a[3]); }
    // SSE2 has no byte shuffle, so centroids are gathered through a stack row.
    using Table=const int8_t *; using Bytes=__m128i; using Acc=__m128i;
    static Table table_i8(const int8_t *book) { return book; }
    static Bytes load_i8(const int8_t *p) { return _mm_loadu_si128(reinterpret_cast<const __m128i *>(p)); }
    static void lookup_i8(Table book,const uint8_t *p,Bytes &lo,Bytes &hi) {
        alignas(16) int8_t l[16],h[16];
        for(size_t i=0;i<16;++i){l[i]=book[p[i]&15];h[i]=book[p[i]>>4];}
        lo=_mm_load_si128(reinterpret_cast<const __m128i *>(l));hi=_mm_load_si128(reinterpret_cast<const __m128i *>(h));
    }
    static Acc dot_acc(Acc acc,Bytes x,Bytes y) {
        auto sx=_mm_cmpgt_epi8(_mm_setzero_si128(),x),sy=_mm_cmpgt_epi8(_mm_setzero_si128(),y);
        acc=_mm_add_epi32(acc,_mm_madd_epi16(_mm_unpacklo_epi8(x,sx),_mm_unpacklo_epi8(y,sy)));
        return _mm_add_epi32(acc,_mm_madd_epi16(_mm_unpackhi_epi8(x,sx),_mm_unpackhi_epi8(y,sy)));
    }
    static int32_t hsum(Acc acc) { int32_t v[4];_mm_storeu_si128(reinterpret_cast<__m128i *>(v),acc);return v[0]+v[1]+v[2]+v[3]; }
    static void butterfly(float *a,float *b) { auto x=_mm_loadu_ps(a),y=_mm_loadu_ps(b);_mm_storeu_ps(a,_mm_add_ps(x,y));_mm_storeu_ps(b,_mm_sub_ps(x,y)); }
};
static void sse_a8(float *x,size_t n) {
    const auto sign=_mm_castsi128_ps(_mm_set1_epi32(0x7fffffff));
    __m128 m=_mm_setzero_ps();size_t i=0;
    for(;i+4<=n;i+=4)m=_mm_max_ps(m,_mm_and_ps(_mm_loadu_ps(x+i),sign));
    float a[4];_mm_storeu_ps(a,m);float maximum=*std::max_element(a,a+4);
    for(;i<n;++i)maximum=std::max(maximum,std::abs(x[i]));
    const float scale=maximum>0?maximum*(1.f/127.f):1.f;
    auto inv=_mm_set1_ps(1.f/scale),s=_mm_set1_ps(scale);i=0;
    for(;i+4<=n;i+=4){
        auto v=_mm_mul_ps(_mm_loadu_ps(x+i),inv);
        v=_mm_min_ps(_mm_set1_ps(127.f),_mm_max_ps(_mm_set1_ps(-128.f),v));
        auto rounded=_mm_cvtepi32_ps(_mm_cvtps_epi32(v));
        rounded=_mm_or_ps(rounded,_mm_and_ps(v,_mm_castsi128_ps(_mm_set1_epi32(int(0x80000000u)))));
        _mm_storeu_ps(x+i,_mm_mul_ps(rounded,s));
    }
    for(;i<n;++i)x[i]=std::max(-128.f,std::min(127.f,std::nearbyint(x[i]/scale)))*scale;
}
const CpuKernels &sse2_kernels(){static const CpuKernels k{"sse2",kernel_project<SseOps>,kernel_integer<SseOps>,kernel_decode<SseOps>,kernel_fwht<SseOps>,sse_a8};return k;}
} // namespace needle_cpu
