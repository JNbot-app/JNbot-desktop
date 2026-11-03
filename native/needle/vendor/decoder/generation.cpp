#include "needle.h"
#include <cmath>
#include <limits>

int32_t np_select_token(const float *logits, const uint8_t *allowed, size_t count) {
    if (!logits || !count || count > size_t(INT32_MAX))
        return -1;
    float best = -std::numeric_limits<float>::infinity();
    int32_t token = -1;
    for (size_t i = 0; i < count; ++i) {
        if (!std::isfinite(logits[i]))
            return -1;
        if ((!allowed || allowed[i]) && (token < 0 || logits[i] > best)) {
            best = logits[i];
            token = int32_t(i);
        }
    }
    return token;
}
