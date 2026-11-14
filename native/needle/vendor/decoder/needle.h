#ifndef NEEDLE_CPU_H
#define NEEDLE_CPU_H
#include <stddef.h>
#include <stdint.h>
#if defined(_WIN32)
#if defined(NEEDLE_CPU_STATIC)
#define NP_API
#elif defined(NEEDLE_CPU_BUILD)
#define NP_API __declspec(dllexport)
#else
#define NP_API __declspec(dllimport)
#endif
#else
#define NP_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct np_handle np_handle;
typedef int32_t (*np_trace_callback)(void *, int32_t, uint32_t, const char *, int32_t,
                                     const float *, size_t);
NP_API uint32_t np_abi_version(void);
// threads controls packed projection workers; dense BLAS owns its scheduling.
// C callers must finish all operations before freeing a handle.
NP_API np_handle *np_load(const char *, uint64_t, uint64_t, int32_t, char *, size_t);
// Clone shares immutable mapped weights; request state and scratch are independent.
NP_API np_handle *np_clone(np_handle *, char *, size_t);
NP_API void np_free(np_handle *);
NP_API void np_reset(np_handle *);
NP_API int32_t np_tensor_info(np_handle *, int32_t, uint32_t *, uint32_t *, char *, size_t);
NP_API int32_t np_row(np_handle *, int32_t, uint32_t, float *, size_t, char *, size_t);
NP_API int32_t np_matvec(np_handle *, int32_t, const float *, size_t, float *, size_t, char *,
                         size_t);
// Stateless full prefill. Does not alter the cached request.
NP_API int32_t np_forward(np_handle *, const int32_t *, size_t, float *, size_t, float *, size_t,
                          char *, size_t);
NP_API int32_t np_forward_trace(np_handle *, const int32_t *, size_t, float *, size_t,
                                np_trace_callback, void *, char *, size_t);
// Cached prefill or continuation. np_decode requires exactly one token.
NP_API int32_t np_eval(np_handle *, const int32_t *, size_t, float *, size_t, char *, size_t);
NP_API int32_t np_decode(np_handle *, int32_t, float *, size_t, char *, size_t);
// KV window in tokens (0: the archive's own). Changing it drops the cached request state.
NP_API int32_t np_set_window(np_handle *, size_t, char *, size_t);
// Keep the state after the first `count` prompt tokens (rounded down to whole prefill chunks).
// A later prompt starting with the same tokens skips their prefill; results are unchanged.
NP_API int32_t np_set_prefix(np_handle *, size_t, char *, size_t);
// Prompt tokens restored from the prefix cache by the last prefill.
NP_API size_t np_prefix_reused(np_handle *);
NP_API int32_t np_engram(np_handle *, const int32_t *, size_t, float *, size_t, char *, size_t);
NP_API int32_t np_replay_norm(np_handle *, int32_t, const float *, size_t, float *, size_t, char *,
                              size_t);
NP_API int32_t np_replay_projection(np_handle *, int32_t, const float *, size_t, float *, size_t,
                                    char *, size_t);
NP_API int32_t np_replay_convolution(np_handle *, int32_t, const float *, size_t, size_t, float *,
                                     size_t, char *, size_t);
NP_API int32_t np_replay_rope(np_handle *, uint32_t, const float *, size_t, float *, size_t, char *,
                              size_t);
NP_API int32_t np_replay_a8(const float *, size_t, float *, size_t, char *, size_t);
// Optional fusion ABI v1. Canonical FP32 tensor order is documented in fusion.cpp.
NP_API int32_t np_fusion_attach(np_handle *, const float *, size_t, char *, size_t);
// Preparation is only permitted before prefill; reset invalidates request memory.
NP_API int32_t np_fusion_prepare(np_handle *, const float *, size_t, int32_t, char *, size_t);
NP_API int32_t np_fusion_memory(np_handle *, float *, size_t, char *, size_t);
NP_API int32_t np_fusion_replay(np_handle *, int32_t, float *, size_t, char *, size_t);
// Representation fusion extension ABI v2: three-site banks, replay takes site 0..2.
NP_API uint32_t np_representation_abi_version(void);
NP_API int32_t np_representation_attach(np_handle *, const float *, size_t, char *, size_t);
NP_API int32_t np_representation_prepare(np_handle *, const float *, size_t, const float *, size_t, char *, size_t);
NP_API int32_t np_representation_disable(np_handle *, char *, size_t);
/* Diagnostic: nonzero excludes the pooled query slot from every memory read. */
NP_API int32_t np_representation_mask_pooled(np_handle *, int32_t, char *, size_t);
NP_API int32_t np_representation_memory(np_handle *, float *, size_t, char *, size_t);
NP_API int32_t np_representation_replay(np_handle *, int32_t, const float *, float *, char *, size_t);
// Greedy selection with a caller-supplied grammar mask. Ties choose lowest ID.
NP_API int32_t np_select_token(const float *, const uint8_t *, size_t);
NP_API size_t np_decoded_buffer_bytes(np_handle *);
// Allocated numerical-buffer capacities, excluding allocator/handle overhead.
// Mapped weights are shared by clones; the other fields are per request.
typedef struct np_memory_info {
    uint64_t mapped_weights_bytes;
    uint64_t decoded_workspace_bytes;
    uint64_t kv_bytes;
    uint64_t scratch_bytes;
} np_memory_info;
NP_API int32_t np_memory_stats(np_handle *, np_memory_info *, char *, size_t);
NP_API void np_profile_enable(int32_t);
NP_API void np_profile_reset(void);
NP_API int32_t np_profile_dump(char *, size_t);
NP_API void np_profile_print(void);
// Cached normalized state for the optional rejection head.
NP_API int32_t np_last_hidden(np_handle *, float *, size_t, char *, size_t);
// Scores the cached prompt and completion using the archive's confidence head.
// Returns 1 with a score, 0 when no head is present, or -1 on error.
NP_API int32_t np_confidence(np_handle *, float *, char *, size_t);

#ifdef __cplusplus
}
#endif
#endif
