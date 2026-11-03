#include "kernel_template.h"
#include <immintrin.h>
namespace needle_cpu {
struct AvxOps {
    using Vec=__m256;
    const float *book;
    explicit AvxOps(const float *p):book(p){}
    Vec lookup(const uint8_t *p) const {
        auto indices=_mm256_set_epi32(p[3]>>4,p[2]>>4,p[1]>>4,p[0]>>4,p[3]&15,p[2]&15,p[1]&15,p[0]&15);
        return _mm256_i32gather_ps(book,indices,4);
    }
    static Vec load(const float *a,const float *b){return _mm256_insertf128_ps(_mm256_castps128_ps256(_mm_loadu_ps(a)),_mm_loadu_ps(b),1);}
    static void store(float *a,float *b,Vec v){_mm_storeu_ps(a,_mm256_castps256_ps128(v));_mm_storeu_ps(b,_mm256_extractf128_ps(v,1));}
    static Vec madd(Vec a,Vec w,Vec x){return _mm256_add_ps(a,_mm256_mul_ps(w,x));}
    static Vec scale(Vec v,float s){return _mm256_mul_ps(v,_mm256_set1_ps(s));}
    static float sum(Vec v){float a[4];_mm_storeu_ps(a,_mm_add_ps(_mm256_castps256_ps128(v),_mm256_extractf128_ps(v,1)));return (a[0]+a[1])+(a[2]+a[3]);}
    using Table=__m128i; using Bytes=__m128i; using Acc=__m256i;
    static Table table_i8(const int8_t *book) { return _mm_loadu_si128(reinterpret_cast<const __m128i *>(book)); }
    static Bytes load_i8(const int8_t *p) { return _mm_loadu_si128(reinterpret_cast<const __m128i *>(p)); }
    static void lookup_i8(Table table,const uint8_t *p,Bytes &lo,Bytes &hi) {
        auto codes=_mm_loadu_si128(reinterpret_cast<const __m128i *>(p));
        lo=_mm_shuffle_epi8(table,_mm_and_si128(codes,_mm_set1_epi8(15)));
        hi=_mm_shuffle_epi8(table,_mm_and_si128(_mm_srli_epi16(codes,4),_mm_set1_epi8(15)));
    }
    static Acc dot_acc(Acc acc,Bytes x,Bytes y) {
        return _mm256_add_epi32(acc,_mm256_madd_epi16(_mm256_cvtepi8_epi16(x),_mm256_cvtepi8_epi16(y)));
    }
    static int32_t hsum(Acc acc) {
        int32_t v[8];_mm256_storeu_si256(reinterpret_cast<__m256i *>(v),acc);
        int32_t s=0;for(int i=0;i<8;++i)s+=v[i];return s;
    }
    static void butterfly(float *a,float *b){auto x=_mm_loadu_ps(a),y=_mm_loadu_ps(b);_mm_storeu_ps(a,_mm_add_ps(x,y));_mm_storeu_ps(b,_mm_sub_ps(x,y));}
};
static void avx_a8(float *x,size_t n){
    const auto sign=_mm256_castsi256_ps(_mm256_set1_epi32(0x7fffffff));
    auto m=_mm256_setzero_ps();size_t i=0;
    for(;i+8<=n;i+=8)m=_mm256_max_ps(m,_mm256_and_ps(_mm256_loadu_ps(x+i),sign));
    float a[8];_mm256_storeu_ps(a,m);float maximum=*std::max_element(a,a+8);
    for(;i<n;++i)maximum=std::max(maximum,std::abs(x[i]));
    const float scale=maximum>0?maximum*(1.f/127.f):1.f;
    auto inv=_mm256_set1_ps(1.f/scale),s=_mm256_set1_ps(scale);i=0;
    // Process four-element tails with reciprocal arithmetic too, matching A8.
    for(;i+8<=n;i+=8){auto v=_mm256_mul_ps(_mm256_loadu_ps(x+i),inv);
        v=_mm256_min_ps(_mm256_set1_ps(127.f),_mm256_max_ps(_mm256_set1_ps(-128.f),v));
        v=_mm256_round_ps(v,_MM_FROUND_CUR_DIRECTION|_MM_FROUND_NO_EXC);
        _mm256_storeu_ps(x+i,_mm256_mul_ps(v,s));}
    if(i+4<=n){for(size_t j=0;j<4;++j)x[i+j]=std::max(-128.f,std::min(127.f,std::nearbyint(x[i+j]*(1.f/scale))))*scale;i+=4;}
    for(;i<n;++i)x[i]=std::max(-128.f,std::min(127.f,std::nearbyint(x[i]/scale)))*scale;
}
const CpuKernels &avx2_kernels(){static const CpuKernels k{"avx2",kernel_project<AvxOps>,kernel_integer<AvxOps>,kernel_decode<AvxOps>,kernel_fwht<AvxOps>,avx_a8};return k;}
} // namespace needle_cpu
