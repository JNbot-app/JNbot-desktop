#pragma once
#include "ggml.h"
#include <cstdio>

// llama.cpp's default callback prints DEBUG messages too. Keep actionable
// diagnostics, including continuation fragments belonging to a warning/error.
inline void eg_log(ggml_log_level level, const char * text, void *) {
    static thread_local bool diagnostic = false;
    if (level != GGML_LOG_LEVEL_CONT)
        diagnostic = level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR;
    if (diagnostic && text) std::fputs(text, stderr);
}
