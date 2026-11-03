#ifndef NEEDLE_FUSION_ENCODER_H
#define NEEDLE_FUSION_ENCODER_H
#include <stddef.h>
#include <stdint.h>
#ifdef _WIN32
# if defined(EG_STATIC)
#  define EG_API
# elif defined(EG_BUILD)
#  define EG_API __declspec(dllexport)
# else
#  define EG_API __declspec(dllimport)
# endif
#else
# define EG_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct eg_handle eg_handle;
// offset permits loading a GGUF section in a larger, aligned model container.
EG_API eg_handle * eg_load(const char * path, uint64_t offset, int32_t context,
                          int32_t threads, const char * backend, char * error, size_t error_size);
EG_API int32_t eg_token_count(eg_handle *, const char * text, char * error, size_t error_size);
// Features are row-major [token_count, 512], before output projection, not pooled vectors.
EG_API int32_t eg_encode(eg_handle *, const char * text, float * features, size_t feature_capacity,
                        float * pooled, size_t pooled_capacity, char * error, size_t error_size);
EG_API const char * eg_backend(const eg_handle *);
EG_API const char * eg_revision(void);
EG_API const char * eg_source_sha256(void);
EG_API void eg_free(eg_handle *);
#ifdef __cplusplus
}
#endif
#endif
