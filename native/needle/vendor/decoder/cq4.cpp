#include "internal.h"
#include "kernels.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <cmath>
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif
#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#else
#include <cblas.h>
#endif

namespace needle_cpu {
void cq4_prepare_input(const float *x, size_t cols, size_t padded, size_t batch,
                       float *inputs, float *scratch_rotated) {
    ProfileTimer timer(PHASE_MATH_FWHT);
    for (size_t b=0;b<batch;++b) {
        std::copy_n(x+b*cols,cols,scratch_rotated);
        std::fill(scratch_rotated+cols,scratch_rotated+padded,0.f);
        for(size_t g=0;g<padded/128;++g) {
            float *group=scratch_rotated+g*128;
            fwht(group,128);
            for(size_t k=0;k<64;++k) {
                inputs[b*padded+g*64+k]=group[2*k];
                inputs[b*padded+padded/2+g*64+k]=group[2*k+1];
            }
        }
    }
}
struct ProjectionJob {
    const Tensor &tensor;
    const CpuKernels &kernel;
    const float *inputs,*weights;
    size_t batch,begin,stride;
    float *out;
    const IntegerInput *integer = nullptr;
};
static void project_rows(void *context,size_t first,size_t last) {
    const auto &job=*static_cast<ProjectionJob *>(context);
    if (job.integer) {
        job.kernel.project_i8(job.tensor,*job.integer,job.begin+first,last-first,job.out+first);
        return;
    }
    job.kernel.project(job.tensor,job.inputs,job.weights?job.weights+first*job.tensor.padded:nullptr,
                       job.batch,job.begin+first,last-first,job.out+first,job.stride);
}
static IntegerInput integer_input(const Tensor &t,const float *inputs,std::vector<float> &tile) {
    const size_t groups=t.padded/128,half=t.padded/2;
    if(t.padded+16+groups*2*sizeof(float)>tile.size()*sizeof(float))
        throw std::invalid_argument("Integer input exceeds decoded workspace");
    auto *activation=reinterpret_cast<int8_t *>(tile.data());
    int8_t *book=activation+t.padded;
    float *scales=tile.data()+(t.padded+16)/sizeof(float);
    float maximum=0.f;
    for(float v:t.book)maximum=std::max(maximum,std::abs(v));
    const float book_scale=maximum>0 ? maximum/127.f : 1.f,inv_book=1.f/book_scale;
    if(!std::isfinite(inv_book))throw std::invalid_argument("Integer codebook scale underflow");
    for(size_t i=0;i<16;++i)
        book[i]=int8_t(std::clamp(int(std::round(t.book[i]*inv_book)),-128,127));
    for(size_t g=0;g<groups;++g)
        for(size_t part=0;part<2;++part) {
            const size_t offset=part*half+g*64;
            float max_input=0.f;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
            float32x4_t maximum=vdupq_n_f32(0.f);
            for(size_t k=0;k<64;k+=4)
                maximum=vmaxq_f32(maximum,vabsq_f32(vld1q_f32(inputs+offset+k)));
            max_input=vmaxvq_f32(maximum);
#else
            for(size_t k=0;k<64;++k)max_input=std::max(max_input,std::abs(inputs[offset+k]));
#endif
            const float scale=max_input>0 ? max_input*(1.f/127.f) : 1.f,inv=1.f/scale;
            if(!std::isfinite(scale) || !std::isfinite(inv))
                throw std::invalid_argument("Integer activation scale outside FP32 range");
            scales[g*2+part]=scale*book_scale;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
            for(size_t k=0;k<64;k+=16) {
                const float *x=inputs+offset+k;
                const int16x8_t lo=vcombine_s16(vqmovn_s32(vcvtnq_s32_f32(vmulq_n_f32(vld1q_f32(x),inv))),
                                               vqmovn_s32(vcvtnq_s32_f32(vmulq_n_f32(vld1q_f32(x+4),inv))));
                const int16x8_t hi=vcombine_s16(vqmovn_s32(vcvtnq_s32_f32(vmulq_n_f32(vld1q_f32(x+8),inv))),
                                               vqmovn_s32(vcvtnq_s32_f32(vmulq_n_f32(vld1q_f32(x+12),inv))));
                vst1q_s8(activation+offset+k,vcombine_s8(vqmovn_s16(lo),vqmovn_s16(hi)));
            }
#else
            for(size_t k=0;k<64;++k) {
                const float v=inputs[offset+k]*inv;
                // VCVTN's ties-to-even contract, independent of the caller's FE mode.
                const float floor=std::floor(v),fraction=v-floor;
                int q=int(floor);
                if(fraction>.5f || (fraction==.5f && q%2))++q;
                activation[offset+k]=int8_t(std::clamp(q,-128,127));
            }
#endif
        }
    return {activation,scales,book};
}
static void dispatch(ProjectionJob &job,size_t rows,ProjectionWorkers *workers) {
    if(workers && rows>=64 && rows*job.tensor.shape[1]*job.batch>=262144)
        workers->run(rows,&job,project_rows);
    else project_rows(&job,0,rows);
}
void cq4_project_prepared(const Tensor &t,const float *inputs,size_t batch,float *out,
                          size_t begin,size_t rows,std::vector<float> &tile,ProjectionWorkers *workers,bool exact) {
    ProfileTimer timer(PHASE_MATH_PACKED_DOT);
    const auto &kernel=cpu_kernels();
    if(batch==1) {
        ProjectionJob job{t,kernel,inputs,nullptr,batch,begin,rows,out};
        IntegerInput quantized{};
        if(!exact) { quantized=integer_input(t,inputs,tile);job.integer=&quantized; }
        dispatch(job,rows,workers);
        return;
    }
    const size_t tile_rows=tile.size()/t.padded;
    if(!tile_rows) throw std::invalid_argument("Projection width exceeds decoded workspace");
    for(size_t start=0;start<rows;start+=tile_rows) {
        const size_t count=std::min(tile_rows,rows-start);
        kernel.decode_tile(t,begin+start,count,tile.data(),!exact);
        if(exact) {
            ProjectionJob job{t,kernel,inputs,tile.data(),batch,begin+start,rows,out+start};
            dispatch(job,count,workers);
        } else {
            cblas_sgemm(CblasRowMajor,CblasNoTrans,CblasTrans,int(batch),int(count),int(t.padded),
                        1.f,inputs,int(t.padded),tile.data(),int(t.padded),0.f,out+start,int(rows));
        }
    }
}
void cq4_project(const Tensor &t,const float *x,size_t batch,float *out,size_t begin,
                 size_t rows,std::vector<float> &scratch,std::vector<float> &tile,ProjectionWorkers *workers,bool exact) {
    scratch.resize(std::max(size_t(8192),(batch+1)*t.padded));
    float *rotated=scratch.data(),*inputs=rotated+t.padded;
    cq4_prepare_input(x,t.shape[1],t.padded,batch,inputs,rotated);
    cq4_project_prepared(t,inputs,batch,out,begin,rows,tile,workers,exact);
}
} // namespace needle_cpu
