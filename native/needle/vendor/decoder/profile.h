#pragma once
#include "kernels.h"
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

namespace needle_cpu {

enum ProfilePhase {
    PHASE_EVAL_RUN = 0,

    // Engram
    PHASE_ENGRAM_TOTAL,
    PHASE_ENGRAM_HASH,
    PHASE_ENGRAM_ROW_GATHER,
    PHASE_ENGRAM_PROJECT,
    PHASE_ENGRAM_CONV,

    // Layer breakdown
    PHASE_LANE_INPUT_NORM_A8,
    PHASE_MHC_PROJ_PRE,
    PHASE_MHC_PROJ_POST,
    PHASE_MHC_PROJ_RES,
    PHASE_LANE_MIXING,
    PHASE_ENGRAM_ATTN_MIX,
    PHASE_BLOCK_INPUT_NORM_A8,

    // Attention
    PHASE_ATTN_PROJ_Q,
    PHASE_ATTN_PROJ_K,
    PHASE_ATTN_PROJ_V,
    PHASE_ATTN_PROJ_GATE,
    PHASE_ATTN_CONV,
    PHASE_ATTN_ROPE_NORM,
    PHASE_ATTN_CORE,
    PHASE_ATTN_SCORES,
    PHASE_ATTN_SOFTMAX,
    PHASE_ATTN_VALUES,
    PHASE_ATTN_KV_PUT,
    PHASE_REPRESENTATION_READER,
    PHASE_ATTN_GATE_A8,
    PHASE_ATTN_PROJ_OUT,

    // Monarch MLP
    PHASE_POST_ATTN_NORM,
    PHASE_MONARCH_TOTAL,
    PHASE_MONARCH_DENSE_CV,
    PHASE_MONARCH_DENSE_CU,
    PHASE_MONARCH_KRON,
    PHASE_MONARCH_ACT,

    // Sinkhorn & Lane update
    PHASE_SINKHORN,
    PHASE_LANE_UPDATE,

    // Final output
    PHASE_FINAL_POOL_NORM_A8,
    PHASE_FINAL_LOGITS_PROJECT,

    // Low-level Math::project breakdown
    PHASE_MATH_FWHT,
    PHASE_MATH_PACKED_DOT,
    PHASE_MATH_FALLBACK_GEMM,

    PHASE_COUNT
};

struct PhaseMeta {
    const char *id;
    const char *name;
    const char *category;
};

inline const PhaseMeta &get_phase_meta(ProfilePhase phase) {
    static const PhaseMeta meta[PHASE_COUNT] = {
        {"eval_run", "Total C++ Eval", "Top"},
        {"engram_total", "Engram Total", "Engram"},
        {"engram_hash", "Engram Token Hashing", "Engram"},
        {"engram_gather", "Engram Row Gather & A8", "Engram"},
        {"engram_proj", "Engram Projections", "Engram"},
        {"engram_conv", "Engram History Conv", "Engram"},
        {"lane_input_norm_a8", "Lane Input Norm & A8", "Layer"},
        {"mhc_proj_pre", "MHC Pre-Projection", "MHC"},
        {"mhc_proj_post", "MHC Post-Projection", "MHC"},
        {"mhc_proj_res", "MHC Res-Projection", "MHC"},
        {"lane_mixing", "Lane Mixing", "Layer"},
        {"engram_attn_mix", "Engram Site Attention Mix", "Layer"},
        {"block_input_norm_a8", "Block Input Norm & A8", "Layer"},
        {"attn_proj_q", "Attention Q Projection", "Attention"},
        {"attn_proj_k", "Attention K Projection", "Attention"},
        {"attn_proj_v", "Attention V Projection", "Attention"},
        {"attn_proj_gate", "Attention Gate Projection", "Attention"},
        {"attn_conv", "Attention Taps Conv", "Attention"},
        {"attn_rope_norm", "Attention RoPE & Norm", "Attention"},
        {"attn_core", "Attention Core (QK^T + Softmax + SV)", "Attention"},
        {"attn_scores", "Attention QK Scores", "Attention"},
        {"attn_softmax", "Attention Softmax", "Attention"},
        {"attn_values", "Attention Value Accumulation", "Attention"},
        {"attn_kv_put", "Attention KV Quantization", "Attention"},
        {"representation_reader", "Gemma Memory Reader", "Attention"},
        {"attn_gate_a8", "Attention Gate Sigmoid & A8", "Attention"},
        {"attn_proj_out", "Attention Out Projection", "Attention"},
        {"post_attn_norm", "Post-Attention Norm & Agate", "Layer"},
        {"monarch_total", "Monarch MLP Total", "Monarch"},
        {"monarch_dense_cv", "Monarch Dense CV (768->8)", "Monarch"},
        {"monarch_dense_cu", "Monarch Dense CU (8->1024)", "Monarch"},
        {"monarch_kron", "Monarch Kronecker Products", "Monarch"},
        {"monarch_act", "Monarch Non-linearities", "Monarch"},
        {"sinkhorn", "Sinkhorn Iterations (20x)", "MHC"},
        {"lane_update", "Lane Stream Update", "Layer"},
        {"final_pool_norm_a8", "Final Pool, Norm & A8", "Final"},
        {"final_logits_proj", "Final Logits Projection (Vocab)", "Final"},
        {"math_fwht", "Math FWHT", "Kernel"},
        {"math_packed_dot", "Math Packed Dot", "Kernel"},
        {"math_fallback_gemm", "Math Fallback Tile+GEMM", "Kernel"},
    };
    return meta[phase];
}

class Profiler {
public:
    struct Stat {
        uint64_t prefill_ns = 0;
        uint64_t decode_ns = 0;
        uint64_t prefill_calls = 0;
        uint64_t decode_calls = 0;
    };

    static bool &enabled() {
        static bool is_enabled = []() {
            const char *env = std::getenv("NEEDLE_PROFILE");
            if (!env)
                env = std::getenv("NEEDLE_CPU_PROFILE");
            return env && (std::strcmp(env, "1") == 0 || std::strcmp(env, "true") == 0);
        }();
        return is_enabled;
    }

    static void set_enabled(bool e) { enabled() = e; }

    static bool &is_prefill() {
        static thread_local bool current_is_prefill = false;
        return current_is_prefill;
    }

    static void set_prefill(bool prefill) { is_prefill() = prefill; }

    static void record(ProfilePhase phase, uint64_t ns) {
        if (!enabled())
            return;
        std::lock_guard<std::mutex> lock(mutex());
        auto &s = stats()[phase];
        if (is_prefill()) {
            s.prefill_ns += ns;
            s.prefill_calls++;
        } else {
            s.decode_ns += ns;
            s.decode_calls++;
        }
    }

    static void record_tokens(size_t count, bool prefill) {
        if (!enabled())
            return;
        std::lock_guard<std::mutex> lock(mutex());
        if (prefill)
            prefill_tokens_count() += count;
        else
            decode_tokens_count() += count;
    }

    static void reset() {
        std::lock_guard<std::mutex> lock(mutex());
        for (auto &s : stats()) {
            s = Stat{};
        }
        prefill_tokens_count() = 0;
        decode_tokens_count() = 0;
    }

    static std::string dump_json() {
        std::lock_guard<std::mutex> lock(mutex());
        std::ostringstream ss;
        ss << std::fixed << std::setprecision(4);
        ss << "{\n";
        ss << "  \"kernel\": \"" << cpu_kernels().name << "\",\n";
        ss << "  \"blas\": \"" << NEEDLE_BLAS_NAME << "\",\n";
        ss << "  \"decoded_workspace_bytes\": 4194304,\n";
        ss << "  \"enabled\": " << (enabled() ? "true" : "false") << ",\n";
        ss << "  \"prefill_tokens\": " << prefill_tokens_count() << ",\n";
        ss << "  \"decode_tokens\": " << decode_tokens_count() << ",\n";
        ss << "  \"phases\": {\n";
        for (size_t i = 0; i < PHASE_COUNT; ++i) {
            const auto &m = get_phase_meta(static_cast<ProfilePhase>(i));
            const auto &s = stats()[i];
            ss << "    \"" << m.id << "\": {\n";
            ss << "      \"name\": \"" << m.name << "\",\n";
            ss << "      \"category\": \"" << m.category << "\",\n";
            ss << "      \"prefill_ms\": " << (s.prefill_ns / 1e6) << ",\n";
            ss << "      \"decode_ms\": " << (s.decode_ns / 1e6) << ",\n";
            ss << "      \"total_ms\": " << ((s.prefill_ns + s.decode_ns) / 1e6) << ",\n";
            ss << "      \"prefill_calls\": " << s.prefill_calls << ",\n";
            ss << "      \"decode_calls\": " << s.decode_calls << ",\n";
            ss << "      \"total_calls\": " << (s.prefill_calls + s.decode_calls) << "\n";
            ss << "    }" << (i + 1 < PHASE_COUNT ? "," : "") << "\n";
        }
        ss << "  }\n";
        ss << "}\n";
        return ss.str();
    }

    static void print_summary() {
        std::lock_guard<std::mutex> lock(mutex());
        std::cerr << "\n=================== NEEDLE CPU PROFILER SUMMARY ===================\n";
        std::cerr << "Prefill Tokens: " << prefill_tokens_count()
                  << " | Decode Tokens: " << decode_tokens_count() << "\n";
        std::cerr << "-------------------------------------------------------------------\n";
        std::cerr << std::left << std::setw(36) << "Phase"
                  << std::right << std::setw(12) << "Prefill (ms)"
                  << std::setw(12) << "Decode (ms)"
                  << std::setw(12) << "Total (ms)"
                  << std::setw(10) << "Calls" << "\n";
        std::cerr << "-------------------------------------------------------------------\n";
        for (size_t i = 0; i < PHASE_COUNT; ++i) {
            const auto &m = get_phase_meta(static_cast<ProfilePhase>(i));
            const auto &s = stats()[i];
            double prefill_ms = s.prefill_ns / 1e6;
            double decode_ms = s.decode_ns / 1e6;
            double total_ms = prefill_ms + decode_ms;
            if (total_ms < 0.001 && (s.prefill_calls + s.decode_calls) == 0)
                continue;
            std::cerr << std::left << std::setw(36) << m.name
                      << std::right << std::fixed << std::setprecision(2)
                      << std::setw(12) << prefill_ms
                      << std::setw(12) << decode_ms
                      << std::setw(12) << total_ms
                      << std::setw(10) << (s.prefill_calls + s.decode_calls) << "\n";
        }
        std::cerr << "===================================================================\n\n";
    }

private:
    static std::mutex &mutex() {
        static std::mutex m;
        return m;
    }

    static std::vector<Stat> &stats() {
        static std::vector<Stat> s(PHASE_COUNT);
        return s;
    }

    static uint64_t &prefill_tokens_count() {
        static uint64_t c = 0;
        return c;
    }

    static uint64_t &decode_tokens_count() {
        static uint64_t c = 0;
        return c;
    }
};

struct ProfileTimer {
    ProfilePhase phase;
    std::chrono::high_resolution_clock::time_point start;
    bool active;

    explicit ProfileTimer(ProfilePhase p) : phase(p), active(Profiler::enabled()) {
        if (active)
            start = std::chrono::high_resolution_clock::now();
    }

    ~ProfileTimer() {
        if (active) {
            auto end = std::chrono::high_resolution_clock::now();
            uint64_t ns =
                std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count();
            Profiler::record(phase, ns);
        }
    }
};

struct ProfileScopeMode {
    bool previous;
    explicit ProfileScopeMode(bool is_prefill) : previous(Profiler::is_prefill()) {
        Profiler::set_prefill(is_prefill);
    }
    ~ProfileScopeMode() { Profiler::set_prefill(previous); }
};

} // namespace needle_cpu
