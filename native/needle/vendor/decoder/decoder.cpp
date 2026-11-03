#include "internal.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#else
#include <cblas.h>
#endif
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#endif

namespace needle_cpu {
Decoder::Decoder(std::shared_ptr<Model> m, std::shared_ptr<ProjectionWorkers> team)
    : model(std::move(m)), math(std::move(team)) {
    model->validate_decoder();
    auto &h = model->h;
    d = h[7];
    n = h[15];
    nh = h[8];
    nkh = h[9];
    qd = h[11];
    vd = h[12];
    win = h[3];
    hn = h[14];
    sites = h[31];
    if (model->confidence_head)
        confidence = std::make_unique<ConfidencePool>(*model);
    if (nh / nkh > 16 || qd > 256)
        throw std::invalid_argument("Attention geometry exceeds decode workspace");
    block_capacity = batch_size;
    for (size_t i = 0; i < h[10]; ++i) {
        cache.emplace_back(win, nkh, qd, vd);
        qhist.emplace_back(h[19], nh * qd);
        khist.emplace_back(h[19], nkh * qd);
        vhist.emplace_back(h[19], nkh * vd);
    }
    for (size_t i = 0; i < sites; ++i)
        ehist.emplace_back((h[23] - 1) * h[24] + 1, d);
    size_t history = 1;
    for (size_t i = 0; i < h[26]; ++i)
        history = std::max(history, size_t(h[27 + i]));
    token_history.resize(history);
    stream.resize(batch_size * n * d);
    memory.resize(sites * 2 * batch_size * d);
    gathered.resize(batch_size * d);
    scratch.resize(batch_size *
                       (12 * n * d + 12 * nh * std::max(qd, vd) + 8 * hn + 8 * d + 4 * n * n) +
                   4 * win + 4096);
    scratch.resize(scratch.size() + nkh * (win + batch_size) * (qd + vd) +
                   batch_size * (win + batch_size));
    angles.resize(h[13] * qd);
    for (size_t pos = 0; pos < h[13]; ++pos)
        for (size_t j = 0; j < qd / 2; ++j) {
            float angle = float(pos) * (1.f / std::pow(model->theta, float(2 * j) / float(qd)));
            angles[pos * qd + j] = std::cos(angle);
            angles[pos * qd + j + qd / 2] = std::sin(angle);
        }
    for (size_t j = 0; j < 2; ++j) {
        auto &p = j ? p2 : p1;
        p.resize(hn);
        std::vector<bool> seen(hn);
        for (size_t i = 0; i < hn; ++i) {
            float value = model->tensor(int32_t(model->perms + j)).scalar(i);
            if (value < 0 || value >= hn || value != std::floor(value) || seen[size_t(value)])
                throw std::invalid_argument("Invalid Hadamard permutation");
            p[i] = uint32_t(value);
            seen[size_t(value)] = true;
        }
    }
}
void Decoder::reset() {
    position = 0;
    if (confidence) confidence->reset();
    std::fill(token_history.begin(), token_history.end(), 0);
    for (auto &h : qhist)
        h.reset();
    for (auto &h : khist)
        h.reset();
    for (auto &h : vhist)
        h.reset();
    for (auto &h : ehist)
        h.reset();
    // KV bytes need not be cleared: position masks all unwritten slots.
}
void Decoder::prefix_save() {
    const size_t layers = prefix.layers;
    prefix.cache.assign(cache.begin(), cache.begin() + layers);
    prefix.qhist.assign(qhist.begin(), qhist.begin() + layers);
    prefix.khist.assign(khist.begin(), khist.begin() + layers);
    prefix.vhist.assign(vhist.begin(), vhist.begin() + layers);
    prefix.ehist = ehist;
    prefix.token_history = token_history;
    if (confidence && layers == model->layers.size())
        prefix.confidence = std::make_shared<ConfidencePool>(*confidence);
}
void Decoder::prefix_restore() {
    std::copy(prefix.cache.begin(), prefix.cache.end(), cache.begin());
    std::copy(prefix.qhist.begin(), prefix.qhist.end(), qhist.begin());
    std::copy(prefix.khist.begin(), prefix.khist.end(), khist.begin());
    std::copy(prefix.vhist.begin(), prefix.vhist.end(), vhist.begin());
    ehist = prefix.ehist;
    token_history = prefix.token_history;
    if (confidence && prefix.confidence) *confidence = *prefix.confidence;
}
float *Decoder::alloc(size_t count) {
    if (count > scratch.size() - used)
        throw std::runtime_error("Decoder scratch capacity exceeded");
    float *result = scratch.data() + used;
    used += count;
    return result;
}
void Decoder::engram(const int32_t *tokens, size_t count) {
    if (!sites)
        return;
    ProfileTimer timer_engram_total(PHASE_ENGRAM_TOTAL);
    const auto &h = model->h;
    size_t heads = h[26] ? h[22] / h[26] : 0;
    // Advance token hashing history once, then gather all sites using those hashes.
    std::array<uint32_t, batch_size * 32> hashes{};
    if (h[22] > 32)
        throw std::invalid_argument("Too many engram tables");
    {
        ProfileTimer timer_hash(PHASE_ENGRAM_HASH);
        for (size_t t = 0; t < count; ++t) {
            size_t pos = position + t;
            token_history[pos % token_history.size()] = tokens[t];
            for (size_t oi = 0; oi < h[26]; ++oi)
                for (size_t head = 0; head < heads; ++head) {
                    uint32_t hash = 0x9e3779b9u * uint32_t(oi * (h[25] ? h[25] : heads) + head + 1);
                    for (size_t j = 0; j < h[27 + oi]; ++j)
                        hash = (hash ^
                                (j <= pos ? uint32_t(token_history[(pos - j) % token_history.size()])
                                          : 0u)) *
                               0x01000193u;
                    hash ^= hash >> 15;
                    hashes[t * h[22] + oi * heads + head] = hash % h[20];
                }
        }
    }
    for (size_t site = 0; site < sites; ++site) {
        size_t base = model->engrams + site * 4;
        const Tensor &table = model->tensor(int32_t(base));
        {
            ProfileTimer timer_gather(PHASE_ENGRAM_ROW_GATHER);
            for (size_t t = 0; t < count; ++t) {
                float *e = gathered.data() + t * d;
                for (size_t i = 0; i < h[22]; ++i) {
                    table.row(i * h[20] + hashes[t * h[22] + i], e + i * h[21]);
                    if (position + t + 1 < h[27 + i / heads] || size_t(h[27 + i / heads] - 1) >= win)
                        std::fill_n(e + i * h[21], h[21], 0.f);
                }
                a8(e, d);
            }
        }
        float *k = memory.data() + site * 2 * batch_size * d, *v = k + batch_size * d;
        float *raw = nullptr;
        {
            ProfileTimer timer_proj(PHASE_ENGRAM_PROJECT);
            math.project(model->tensor(int32_t(base + 1)), gathered.data(), count, k);
            raw = alloc(count * d);
            math.project(model->tensor(int32_t(base + 2)), gathered.data(), count, raw);
        }
        size_t saved = used;
        {
            ProfileTimer timer_conv(PHASE_ENGRAM_CONV);
            for (size_t t = 0; t < count; ++t)
                ehist[site].convolve(raw + t * d, v + t * d, position + t,
                                     model->tensor(int32_t(base + 3)), h[24], win);
        }
        used = saved;
    }
}
namespace {
// Decode attention for each KV head and the query heads that share it.
struct AttendJob {
    const KV *kv;
    const float *queries;
    float *scores, *out;
    size_t group, first, count, window;
    float scale;
};
void attend_heads(void *context, size_t begin, size_t end) {
    const auto &job = *static_cast<const AttendJob *>(context);
    const KV &kv = *job.kv;
    for (size_t kh = begin; kh < end; ++kh)
        kv.attend(kh, job.queries + kh * job.group * kv.qdim, job.group, job.first, job.count,
                  job.scores + kh * job.group * job.window, job.out + kh * job.group * kv.vdim, job.scale);
}
} // namespace
void Decoder::attention(size_t index, size_t count, const float *x, float *out, Trace trace) {
    size_t saved = used;
    const Layer &l = model->layers[index];
    auto tensor = [&](uint32_t i) -> const Tensor & { return model->tensor(int32_t(i)); };
    size_t qw = nh * qd, kw = nkh * qd, vw = nkh * vd, ow = nh * vd;
    float *qraw = alloc(count * qw), *kraw = alloc(count * kw), *vraw = alloc(count * vw),
          *gates = alloc(count * ow), *values = alloc(count * ow);
    const int memory_site = representation_site(index);
    const bool memory_ready = memory_site >= 0 && representation && representation->ready;
    const bool dedicated_reader = memory_ready && representation->weights->dedicated;
    float *memory_query = memory_ready && !dedicated_reader ? alloc(count * qw) : nullptr;
    size_t q_padded = tensor(l.q).padded;
    float *x_prepared = alloc(count * q_padded);
    math.prepare_input(x, d, q_padded, count, x_prepared);
    {
        ProfileTimer timer_q(PHASE_ATTN_PROJ_Q);
        math.project_prepared(tensor(l.q), x_prepared, count, qraw);
    }
    {
        ProfileTimer timer_k(PHASE_ATTN_PROJ_K);
        math.project_prepared(tensor(l.k), x_prepared, count, kraw);
    }
    {
        ProfileTimer timer_v(PHASE_ATTN_PROJ_V);
        math.project_prepared(tensor(l.v), x_prepared, count, vraw);
    }
    {
        ProfileTimer timer_gate(PHASE_ATTN_PROJ_GATE);
        math.project_prepared(tensor(l.gate), x_prepared, count, gates);
    }
    float *q = alloc(qw), *k = alloc(kw), *v = alloc(vw), *scores = alloc(nh * win),
          *gate_temporary = alloc(ow);
    uint64_t globals = uint64_t(model->h[18]) << 32 | model->h[17];
    size_t window =
        (model->h[16] && !(globals >> index & 1)) ? std::min(win, size_t(model->h[16])) : win;
    KV &kv = cache[index];
    const size_t previous = std::min(position, window - 1), entries = previous + count;
    float *queries = count > 1 ? alloc(count * qw) : nullptr;
    float *keys = count > 1 ? alloc(nkh * entries * qd) : nullptr;
    float *bank_values = count > 1 ? alloc(nkh * entries * vd) : nullptr;
    float *batch_scores = count > 1 ? alloc(count * entries) : nullptr;
    if (count > 1) {
        // Copy before inserting the chunk: ring rollover can overwrite older keys.
        for (size_t j = 0; j < previous; ++j) {
            const size_t slot = (position - previous + j) % win;
            for (size_t h = 0; h < nkh; ++h) {
                const size_t row = slot * nkh + h;
                for (size_t i = 0; i < qd; ++i)
                    keys[(h * entries + j) * qd + i] = float(kv.k[row * qd + i]) * kv.ks[row];
                for (size_t i = 0; i < vd; ++i)
                    bank_values[(h * entries + j) * vd + i] = float(kv.v[row * vd + i]) * kv.vs[row];
            }
        }
    }
    for (size_t t = 0; t < count; ++t) {
        size_t pos = position + t;
        trace.emit(int32_t(index), pos, "q.proj", -1, qraw + t * qw, qw);
        trace.emit(int32_t(index), pos, "k.proj", -1, kraw + t * kw, kw);
        trace.emit(int32_t(index), pos, "v.proj", -1, vraw + t * vw, vw);
        {
            ProfileTimer timer_conv(PHASE_ATTN_CONV);
            if (model->h[19]) {
                qhist[index].convolve(qraw + t * qw, q, pos, tensor(l.qt), 1, window);
                khist[index].convolve(kraw + t * kw, k, pos, tensor(l.kt), 1, window);
                vhist[index].convolve(vraw + t * vw, v, pos, tensor(l.vt), 1, window);
            } else {
                std::copy_n(qraw + t * qw, qw, q);
                std::copy_n(kraw + t * kw, kw, k);
                std::copy_n(vraw + t * vw, vw, v);
            }
        }
        trace.emit(int32_t(index), pos, "q.conv", -1, q, qw);
        trace.emit(int32_t(index), pos, "k.conv", -1, k, kw);
        trace.emit(int32_t(index), pos, "v.conv", -1, v, vw);
        {
            ProfileTimer timer_rope(PHASE_ATTN_ROPE_NORM);
            auto rotary = [&](float *z, size_t heads, const Tensor &scale, const char *norm_label,
                              const char *rope_label) {
                for (size_t head = 0; head < heads; ++head) {
                    float *part = z + head * qd;
                    norm(part, part, qd, scale.floats());
                    trace.emit(int32_t(index), pos, norm_label, int32_t(head), part, qd);
                    if (memory_query && z == q) std::copy_n(part, qd, memory_query + t * qw + head * qd);
                    for (size_t j = 0; j < qd / 2; ++j) {
                        float a = part[j], b = part[j + qd / 2], c = angles[pos * qd + j],
                              s = angles[pos * qd + j + qd / 2];
                        part[j] = a * c - b * s;
                        part[j + qd / 2] = b * c + a * s;
                    }
                    trace.emit(int32_t(index), pos, rope_label, int32_t(head), part, qd);
                }
            };
            rotary(q, nh, tensor(l.qnorm), "q.norm", "q.rope");
            rotary(k, nkh, tensor(l.knorm), "k.norm", "k.rope");
            for (size_t head = 0; head < nh; ++head) {
                trace.quant(int32_t(index), pos, "query.quant", int32_t(head), q + head * qd, qd);
                a8(q + head * qd, qd);
            }
            for (size_t head = 0; head < nkh; ++head) {
                trace.quant(int32_t(index), pos, "key.quant", int32_t(head), k + head * qd, qd);
                trace.quant(int32_t(index), pos, "value.quant", int32_t(head), v + head * vd, vd);
            }
        }
        {
            ProfileTimer timer_kv(PHASE_ATTN_KV_PUT);
            kv.put(pos, k, v);
        }
        if (count > 1) {
            std::copy_n(q, qw, queries + t * qw);
            const size_t slot = pos % win;
            for (size_t h = 0; h < nkh; ++h) {
                const size_t row = slot * nkh + h;
                for (size_t i = 0; i < qd; ++i)
                    keys[(h * entries + previous + t) * qd + i] = float(kv.k[row * qd + i]) * kv.ks[row];
                for (size_t i = 0; i < vd; ++i)
                    bank_values[(h * entries + previous + t) * vd + i] = float(kv.v[row * vd + i]) * kv.vs[row];
            }
            continue;
        }
        size_t available = std::min(pos + 1, window), first = pos + 1 - available;
        ProfileTimer timer_core(PHASE_ATTN_CORE);
        AttendJob job{&kv, q, scores, values + t * ow, nh / nkh, first, available, win,
                      1.0f / std::sqrt(float(qd))};
        if (math.workers && nkh > 1) math.workers->run(nkh, &job, attend_heads, 1);
        else attend_heads(&job, 0, nkh);
    }
    if (count > 1) {
        ProfileTimer timer_core(PHASE_ATTN_CORE);
        attention_prefill(queries, keys, bank_values, batch_scores, values,
                          count, previous, window, nh, nkh, qd, vd);
    }
    for (size_t t = 0; t < count; ++t) {
        const size_t pos = position + t;
        float *result = values + t * ow;
        if (memory_query) representation->read(size_t(memory_site), memory_query + t * qw, result);
        trace.emit(int32_t(index), pos, "attn.output_raw", -1, result, ow);
        trace.emit(int32_t(index), pos, "attn.gate_proj", -1, gates + t * ow, ow);
        {
            ProfileTimer timer_gate(PHASE_ATTN_GATE_A8);
            sigmoid_multiply(result, gates + t * ow, ow, gate_temporary);
            trace.quant(int32_t(index), pos, "attn.output_quant", -1, result, ow);
            a8(result, ow);
        }
    }
    {
        ProfileTimer timer_out(PHASE_ATTN_PROJ_OUT);
        math.project(tensor(l.out), values, count, out);
    }
    if (dedicated_reader) {
        ProfileTimer timer_reader(PHASE_REPRESENTATION_READER);
        representation->read_dedicated(size_t(memory_site), x, out, count);
    }
    for (size_t t = 0; t < count; ++t)
        trace.emit(int32_t(index), position + t, "attn.output_proj", -1, out + t * d, d);
    used = saved;
}
void Decoder::monarch(const Layer &l, const float *x, float *out, size_t count) {
    size_t saved = used;
    auto tensor = [&](uint32_t i) -> const Tensor & { return model->tensor(int32_t(i)); };
    if (count == 1) {
        float *condition = alloc(8), *cond = alloc(hn), *z = alloc(hn), *a = alloc(hn),
              *tmp = alloc(hn);
        {
            ProfileTimer timer_cv(PHASE_MONARCH_DENSE_CV);
            dense(x, tensor(l.cv).floats(), condition, 1, d, 8);
            softmax(condition, 8);
        }
        {
            ProfileTimer timer_cu(PHASE_MONARCH_DENSE_CU);
            dense(condition, tensor(l.cu).floats(), cond, 1, 8, hn);
            const float *diag0 = tensor(l.diagonals).floats();
            for (size_t i = 0; i < hn; ++i) {
                cond[i] += 1.f;
                z[i] = (i < d ? x[i] : 0.f) * diag0[i];
            }
        }
        {
            ProfileTimer timer_kron(PHASE_MONARCH_KRON);
            kron(z, tensor(l.factors), tensor(l.factors + 1), a, tmp);
        }
        {
            ProfileTimer timer_act(PHASE_MONARCH_ACT);
            const float *diag1 = tensor(l.diagonals + 1).floats();
            const float *diag2 = tensor(l.diagonals + 2).floats();
            for (size_t i = 0; i < hn; ++i) {
                float v = diag1[i] * cond[i] * a[p1[i]] + diag2[i];
                z[i] = v;
            }
            sigmoid_multiply(z, z, hn, tmp);
        }
        {
            ProfileTimer timer_kron(PHASE_MONARCH_KRON);
            kron(z, tensor(l.factors + 2), tensor(l.factors + 3), a, tmp);
            const float *diag3 = tensor(l.diagonals + 3).floats();
            for (size_t i = 0; i < hn; ++i)
                z[i] = diag3[i] * a[p2[i]];
            kron(z, tensor(l.factors + 4), tensor(l.factors + 5), a, tmp);
        }
        const float *diag4 = tensor(l.diagonals + 4).floats();
        for (size_t i = 0; i < d; ++i)
            out[i] = diag4[i] * a[i];
        used = saved;
        return;
    }

    float *condition = alloc(count * 8), *cond = alloc(count * hn), *z = alloc(count * hn),
          *a = alloc(count * hn), *tmp = alloc(count * hn);
    {
        ProfileTimer timer_cv(PHASE_MONARCH_DENSE_CV);
        dense(x, tensor(l.cv).floats(), condition, count, d, 8);
        for (size_t t = 0; t < count; ++t)
            softmax(condition + t * 8, 8);
    }
    {
        ProfileTimer timer_cu(PHASE_MONARCH_DENSE_CU);
        dense(condition, tensor(l.cu).floats(), cond, count, 8, hn);
        const float *diag0 = tensor(l.diagonals).floats();
        for (size_t t = 0; t < count; ++t) {
            float *ct = cond + t * hn, *zt = z + t * hn;
            const float *xt = x + t * d;
            for (size_t i = 0; i < hn; ++i) {
                ct[i] += 1.f;
                zt[i] = (i < d ? xt[i] : 0.f) * diag0[i];
            }
        }
    }
    {
        ProfileTimer timer_kron(PHASE_MONARCH_KRON);
        const Tensor &f0 = tensor(l.factors), &f1 = tensor(l.factors + 1);
        int na = int(f0.shape[0]), nb = int(f1.shape[0]);
        for (size_t t = 0; t < count; ++t) {
            cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, na, nb, na, 1.f, f0.floats(), na,
                        z + t * hn, nb, 0.f, tmp + t * hn, nb);
        }
        dense(tmp, f1.floats(), a, count * size_t(na), size_t(nb), size_t(nb));
    }
    {
        ProfileTimer timer_act(PHASE_MONARCH_ACT);
        const float *diag1 = tensor(l.diagonals + 1).floats();
        const float *diag2 = tensor(l.diagonals + 2).floats();
        for (size_t t = 0; t < count; ++t) {
            float *zt = z + t * hn, *ct = cond + t * hn, *at = a + t * hn, *tmpt = tmp + t * hn;
            for (size_t i = 0; i < hn; ++i) {
                float v = diag1[i] * ct[i] * at[p1[i]] + diag2[i];
                zt[i] = v;
            }
            sigmoid_multiply(zt, zt, hn, tmpt);
        }
    }
    {
        ProfileTimer timer_kron(PHASE_MONARCH_KRON);
        const Tensor &f2 = tensor(l.factors + 2), &f3 = tensor(l.factors + 3);
        int na = int(f2.shape[0]), nb = int(f3.shape[0]);
        for (size_t t = 0; t < count; ++t) {
            cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, na, nb, na, 1.f, f2.floats(), na,
                        z + t * hn, nb, 0.f, tmp + t * hn, nb);
        }
        dense(tmp, f3.floats(), a, count * size_t(na), size_t(nb), size_t(nb));

        const float *diag3 = tensor(l.diagonals + 3).floats();
        for (size_t t = 0; t < count; ++t) {
            float *zt = z + t * hn, *at = a + t * hn;
            for (size_t i = 0; i < hn; ++i)
                zt[i] = diag3[i] * at[p2[i]];
        }

        const Tensor &f4 = tensor(l.factors + 4), &f5 = tensor(l.factors + 5);
        int na4 = int(f4.shape[0]), nb5 = int(f5.shape[0]);
        for (size_t t = 0; t < count; ++t) {
            cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, na4, nb5, na4, 1.f, f4.floats(), na4,
                        z + t * hn, nb5, 0.f, tmp + t * hn, nb5);
        }
        dense(tmp, f5.floats(), a, count * size_t(na4), size_t(nb5), size_t(nb5));
    }
    const float *diag4 = tensor(l.diagonals + 4).floats();
    for (size_t t = 0; t < count; ++t) {
        float *out_t = out + t * d, *at = a + t * hn;
        for (size_t i = 0; i < d; ++i)
            out_t[i] = diag4[i] * at[i];
    }
    used = saved;
}
void Decoder::chunk(const int32_t *tokens, size_t count, float *hidden, Trace trace) {
    used = 0;
    const bool cached_chunk = prefix.hit && position < prefix.requested;
    const bool recording = !prefix.hit && prefix.requested && position < prefix.requested;
    const size_t chunk_index = position / block_capacity;
    if (cached_chunk) {
        stream = prefix.streams.at(chunk_index);
        memory = prefix.memories.at(chunk_index);
    } else {
    engram(tokens, count);
    const Tensor &embedding = model->tensor(0);
    for (size_t t = 0; t < count; ++t) {
        float *x = stream.data() + t * n * d;
        embedding.row(size_t(tokens[t]), x);
        for (size_t i = 0; i < d; ++i)
            x[i] *= std::sqrt(float(d));
        if (confidence && tokens[t] != 0) confidence->add(0, x);
        if (hidden && t + 1 == count)
            std::copy_n(x, d, hidden);
        for (size_t lane = 1; lane < n; ++lane)
            std::copy_n(x, d, x + lane * d);
    }
    }
    auto tensor = [&](uint32_t i) -> const Tensor & { return model->tensor(int32_t(i)); };
    for (size_t index = 0; index < model->layers.size(); ++index) {
        if (cached_chunk && index < prefix.layers) continue;
        if (recording && prefix.layers < model->layers.size() && index == prefix.layers) {
            prefix.streams.push_back(stream);
            prefix.memories.push_back(memory);
        }
        used = 0;
        const Layer &l = model->layers[index];
        float *nx = alloc(count * n * d), *pre = alloc(count * n), *post = alloc(count * n),
              *res = alloc(count * n * n), *u = alloc(count * d), *x = alloc(count * d),
              *input = alloc(count * d), *attn = alloc(count * d), *mlp = alloc(count * d);
        {
            ProfileTimer timer_norm(PHASE_LANE_INPUT_NORM_A8);
            for (size_t t = 0; t < count; ++t) {
                trace.emit(int32_t(index), position + t, "lane.input", -1, stream.data() + t * n * d,
                           n * d);
                norm(stream.data() + t * n * d, nx + t * n * d, n * d);
                trace.quant(int32_t(index), position + t, "lane.quant", -1, nx + t * n * d, n * d);
                a8(nx + t * n * d, n * d);
            }
        }
        size_t mhc_dim = n * d;
        size_t mhc_padded = tensor(model->mhc + 6).padded;
        float *nx_prepared = alloc(count * mhc_padded);
        math.prepare_input(nx, mhc_dim, mhc_padded, count, nx_prepared);
        {
            ProfileTimer timer_pre(PHASE_MHC_PROJ_PRE);
            math.project_prepared(tensor(model->mhc + 6), nx_prepared, count, pre, index * n, n);
        }
        {
            ProfileTimer timer_post(PHASE_MHC_PROJ_POST);
            math.project_prepared(tensor(model->mhc + 7), nx_prepared, count, post, index * n, n);
        }
        {
            ProfileTimer timer_res(PHASE_MHC_PROJ_RES);
            math.project_prepared(tensor(model->mhc + 8), nx_prepared, count, res, index * n * n, n * n);
        }
        {
            ProfileTimer timer_mix(PHASE_LANE_MIXING);
            const float mhc_scale_pre = tensor(model->mhc).scalar(index);
            const float *mhc_bias_pre = tensor(model->mhc + 3).floats() + index * n;
            const float mhc_scale_post = tensor(model->mhc + 1).scalar(index);
            const float *mhc_bias_post = tensor(model->mhc + 4).floats() + index * n;
            for (size_t t = 0; t < count; ++t) {
                std::fill_n(u + t * d, d, 0.f);
                for (size_t lane = 0; lane < n; ++lane) {
                    pre[t * n + lane] = sigmoid(mhc_scale_pre * pre[t * n + lane] +
                                                mhc_bias_pre[lane] +
                                                (lane == index % n ? 4.f : -4.f));
                    post[t * n + lane] =
                        2.f * sigmoid(mhc_scale_post * post[t * n + lane] +
                                      mhc_bias_post[lane] +
                                      (lane == index % n ? 0.f : -4.f));
                    float p_val = pre[t * n + lane];
                    const float *s_lane = stream.data() + (t * n + lane) * d;
                    float *ut = u + t * d;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
                    for (size_t i = 0; i < d; i += 4)
                        vst1q_f32(ut + i, vmlaq_n_f32(vld1q_f32(ut + i), vld1q_f32(s_lane + i), p_val));
#else
                    for (size_t i = 0; i < d; ++i)
                        ut[i] += p_val * s_lane[i];
#endif
                }
                trace.emit(int32_t(index), position + t, "lane.mixed", -1, u + t * d, d);
                std::copy_n(u + t * d, d, x + t * d);
            }
        }
        {
            ProfileTimer timer_engram_mix(PHASE_ENGRAM_ATTN_MIX);
            for (size_t t = 0; t < count; ++t) {
                for (size_t site = 0; site < sites; ++site)
                    if (model->h[32 + site] == index) {
                        const float *ek = memory.data() + site * 2 * batch_size * d + t * d,
                                    *ev = ek + batch_size * d;
                        size_t saved = used;
                        float *ux = alloc(d), *uk = alloc(d);
                        norm(x + t * d, ux, d);
                        norm(ek, uk, d);
                        float score = 0;
                        for (size_t i = 0; i < d; ++i)
                            score += ux[i] * uk[i];
                        score = sigmoid(score / std::sqrt(float(d)));
                        for (size_t i = 0; i < d; ++i)
                            x[t * d + i] += score * ev[i];
                        used = saved;
                    }
            }
        }
        {
            ProfileTimer timer_block_norm(PHASE_BLOCK_INPUT_NORM_A8);
            for (size_t t = 0; t < count; ++t) {
                trace.emit(int32_t(index), position + t, "block.input", -1, x + t * d, d);
                norm(x + t * d, input + t * d, d, tensor(l.norm).floats());
                trace.emit(int32_t(index), position + t, "attn.input_norm", -1, input + t * d, d);
                trace.quant(int32_t(index), position + t, "attn.input_quant", -1, input + t * d, d);
                a8(input + t * d, d);
            }
        }
        attention(index, count, input, attn, trace);
        {
            ProfileTimer timer_post_norm(PHASE_POST_ATTN_NORM);
            const float agate_scale = sigmoid(tensor(l.agate).scalar(0));
            const float *post_scale = tensor(l.post).floats();
            const float *pre_scale = tensor(l.pre).floats();
            for (size_t t = 0; t < count; ++t) {
                norm(attn + t * d, attn + t * d, d, post_scale);
                trace.emit(int32_t(index), position + t, "block.post_attn_norm", -1, attn + t * d, d);
                size_t i = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
                float32x4_t v_scale = vdupq_n_f32(agate_scale);
                for (; i + 4 <= d; i += 4) {
                    float32x4_t xv = vld1q_f32(x + t * d + i);
                    float32x4_t av = vld1q_f32(attn + t * d + i);
                    vst1q_f32(x + t * d + i, vfmaq_f32(xv, v_scale, av));
                }
#endif
                for (; i < d; ++i)
                    x[t * d + i] += agate_scale * attn[t * d + i];
                norm(x + t * d, input + t * d, d, pre_scale);
                trace.emit(int32_t(index), position + t, "block.pre_hada_norm", -1, input + t * d, d);
            }
        }
        {
            ProfileTimer timer_monarch_total(PHASE_MONARCH_TOTAL);
            monarch(l, input, mlp, count);
            for (size_t t = 0; t < count; ++t) {
                const float *mlp_t = mlp + t * d;
                trace.emit(int32_t(index), position + t, "block.hadamard", -1, mlp_t, d);
                size_t i = 0;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
                for (; i + 4 <= d; i += 4) {
                    float32x4_t xv = vld1q_f32(x + t * d + i);
                    float32x4_t mv = vld1q_f32(mlp_t + i);
                    vst1q_f32(x + t * d + i, vaddq_f32(xv, mv));
                }
#endif
                for (; i < d; ++i)
                    x[t * d + i] += mlp_t[i];
                trace.emit(int32_t(index), position + t, "block.output", -1, x + t * d, d);
            }
        }
        {
            ProfileTimer timer_sinkhorn(PHASE_SINKHORN);
            const float mhc2 = tensor(model->mhc + 2).scalar(index);
            const float *mhc5 = tensor(model->mhc + 5).floats() + index * n * n;
            for (size_t t = 0; t < count; ++t) {
                float *r = res + t * n * n;
                for (size_t i = 0; i < n * n; ++i)
                    r[i] = mhc2 * r[i] + mhc5[i];
                if (sinkhorn_probabilities(r, n)) continue;
                for (int iteration = 0; iteration < 20; ++iteration)
                    for (int axis = 0; axis < 2; ++axis)
                        for (size_t row = 0; row < n; ++row) {
                            float maximum = -INFINITY, sum = 0;
                            for (size_t col = 0; col < n; ++col)
                                maximum = std::max(maximum, r[axis ? col * n + row : row * n + col]);
                            for (size_t col = 0; col < n; ++col)
                                sum += std::exp(r[axis ? col * n + row : row * n + col] - maximum);
                            float total = maximum + std::log(sum);
                            for (size_t col = 0; col < n; ++col)
                                r[axis ? col * n + row : row * n + col] -= total;
                        }
                for (size_t i = 0; i < n * n; ++i)
                    r[i] = std::exp(r[i]);
            }
        }
        {
            ProfileTimer timer_update(PHASE_LANE_UPDATE);
            for (size_t t = 0; t < count; ++t) {
                const float *r = res + t * n * n;
                float *s = stream.data() + t * n * d;
                const float *xt = x + t * d;
                const float *ut = u + t * d;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
                if (n == 4) {
                    const float p0 = post[t * 4 + 0];
                    const float p1 = post[t * 4 + 1];
                    const float p2 = post[t * 4 + 2];
                    const float p3 = post[t * 4 + 3];
                    const float *r0 = r + 0;
                    const float *r1 = r + 4;
                    const float *r2 = r + 8;
                    const float *r3 = r + 12;
                    float *s0_ptr = s + 0 * d;
                    float *s1_ptr = s + 1 * d;
                    float *s2_ptr = s + 2 * d;
                    float *s3_ptr = s + 3 * d;
                    for (size_t i = 0; i < d; i += 4) {
                        float32x4_t s0 = vld1q_f32(s0_ptr + i);
                        float32x4_t s1 = vld1q_f32(s1_ptr + i);
                        float32x4_t s2 = vld1q_f32(s2_ptr + i);
                        float32x4_t s3 = vld1q_f32(s3_ptr + i);
                        float32x4_t diff = vsubq_f32(vld1q_f32(xt + i), vld1q_f32(ut + i));

                        float32x4_t val0 = vmlaq_n_f32(vdupq_n_f32(0.f), s0, r0[0]);
                        val0 = vmlaq_n_f32(val0, s1, r0[1]);
                        val0 = vmlaq_n_f32(val0, s2, r0[2]);
                        val0 = vmlaq_n_f32(val0, s3, r0[3]);
                        vst1q_f32(s0_ptr + i, vaddq_f32(val0, vmulq_n_f32(diff, p0)));

                        float32x4_t val1 = vmlaq_n_f32(vdupq_n_f32(0.f), s0, r1[0]);
                        val1 = vmlaq_n_f32(val1, s1, r1[1]);
                        val1 = vmlaq_n_f32(val1, s2, r1[2]);
                        val1 = vmlaq_n_f32(val1, s3, r1[3]);
                        vst1q_f32(s1_ptr + i, vaddq_f32(val1, vmulq_n_f32(diff, p1)));

                        float32x4_t val2 = vmlaq_n_f32(vdupq_n_f32(0.f), s0, r2[0]);
                        val2 = vmlaq_n_f32(val2, s1, r2[1]);
                        val2 = vmlaq_n_f32(val2, s2, r2[2]);
                        val2 = vmlaq_n_f32(val2, s3, r2[3]);
                        vst1q_f32(s2_ptr + i, vaddq_f32(val2, vmulq_n_f32(diff, p2)));

                        float32x4_t val3 = vmlaq_n_f32(vdupq_n_f32(0.f), s0, r3[0]);
                        val3 = vmlaq_n_f32(val3, s1, r3[1]);
                        val3 = vmlaq_n_f32(val3, s2, r3[2]);
                        val3 = vmlaq_n_f32(val3, s3, r3[3]);
                        vst1q_f32(s3_ptr + i, vaddq_f32(val3, vmulq_n_f32(diff, p3)));
                    }
                    trace.emit(int32_t(index), position + t, "lane.output", -1, s, 4 * d);
                    continue;
                }
#endif
                size_t saved = used;
                float *next = alloc(n * d);
                for (size_t lane = 0; lane < n; ++lane) {
                    float p_lane = post[t * n + lane];
                    float *next_lane = next + lane * d;
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
                    for (size_t i = 0; i < d; i += 4) {
                        float32x4_t val = vdupq_n_f32(0.f);
                        for (size_t other = 0; other < n; ++other)
                            val = vmlaq_n_f32(val, vld1q_f32(s + other * d + i), r[lane * n + other]);
                        float32x4_t diff = vsubq_f32(vld1q_f32(xt + i), vld1q_f32(ut + i));
                        vst1q_f32(next_lane + i, vaddq_f32(val, vmulq_n_f32(diff, p_lane)));
                    }
#else
                    for (size_t i = 0; i < d; ++i) {
                        float value = 0;
                        for (size_t other = 0; other < n; ++other)
                            value += r[lane * n + other] * s[other * d + i];
                        next_lane[i] = value + p_lane * (xt[i] - ut[i]);
                    }
#endif
                }
                std::copy_n(next, n * d, s);
                used = saved;
                trace.emit(int32_t(index), position + t, "lane.output", -1, s, n * d);
            }
        }
        if (fusion && (index == 9 || index == 19)) {
            fusion->apply(index == 9 ? 0 : 1, stream.data(), count, n);
            if (trace.callback)
                for (size_t t = 0; t < count; ++t)
                    trace.emit(int32_t(index), position + t, "fusion.lane.output", -1,
                               stream.data() + t * n * d, n * d);
        }
        if (hidden) {
            float *mean = hidden + (index + 1) * d;
            std::fill_n(mean, d, 0.f);
            for (size_t lane = 0; lane < n; ++lane)
                for (size_t i = 0; i < d; ++i)
                    mean[i] += stream[((count - 1) * n + lane) * d + i] / float(n);
        }
        if (confidence) {
            std::vector<float> mean(d);
            for (size_t t = 0; t < count; ++t) {
                if (tokens[t] == 0) continue;
                std::fill(mean.begin(), mean.end(), 0.f);
                for (size_t lane = 0; lane < n; ++lane)
                    for (size_t i = 0; i < d; ++i)
                        mean[i] += stream[(t * n + lane) * d + i] / float(n);
                confidence->add(index + 1, mean.data());
            }
        }
    }
    position += count;
    if (position == prefix.requested && prefix.requested) {
        if (prefix.hit) prefix_restore();
        else prefix_save();
    }
}
void Decoder::run(const int32_t *tokens, size_t count, float *logits, float *hidden, Trace trace) {
    ProfileScopeMode mode(count > 1);
    ProfileTimer timer_run(PHASE_EVAL_RUN);
    Profiler::record_tokens(count, count > 1);
    size_t start = 0;
    if (position == 0) {
        prefix.reused = 0;
        const size_t layers = representation && representation->ready ? representation_blocks.front() : model->layers.size();
        const size_t length = std::min(prefix.requested, count / block_capacity * block_capacity);
        // Always leave a suffix so logits use the same original prefill chunk shape.
        const size_t requested = length == count && length ? length - block_capacity : length;
        const bool hit = requested && prefix.layers == layers && prefix.tokens.size() == requested &&
                         std::equal(prefix.tokens.begin(), prefix.tokens.end(), tokens);
        if (!hit) {
            prefix.tokens.assign(tokens, tokens + requested);
            prefix.streams.clear(); prefix.memories.clear();
            prefix.cache.clear(); prefix.qhist.clear(); prefix.khist.clear(); prefix.vhist.clear();
            prefix.ehist.clear(); prefix.token_history.clear();
        }
        prefix.requested = requested;
        prefix.layers = layers;
        prefix.hit = hit;
        if (hit) {
            prefix.reused = requested;
            if (layers == model->layers.size()) {
                prefix_restore();
                position = start = requested;
            }
        }
    }
    for (; start < count; start += block_capacity) {
        size_t t = std::min(block_capacity, count - start);
        chunk(tokens + start, t, start + t == count ? hidden : nullptr, trace);
    }
    used = 0;
    float *x = alloc(d);
    std::fill_n(x, d, 0.f);
    size_t last = (count - 1) % block_capacity;
    {
        ProfileTimer timer_final_pool(PHASE_FINAL_POOL_NORM_A8);
        for (size_t lane = 0; lane < n; ++lane)
            for (size_t i = 0; i < d; ++i)
                x[i] += stream[(last * n + lane) * d + i] / float(n);
        norm(x, x, d, model->tensor(int32_t(model->final_norm)).floats());
        if (hidden)
            std::copy_n(x, d, hidden + (model->layers.size() + 1) * d);
        last_hidden.assign(x, x + d);
        a8(x, d);
    }
    {
        ProfileTimer timer_logits(PHASE_FINAL_LOGITS_PROJECT);
        math.project(model->tensor(0), x, 1, logits, 0, model->h[6] ? model->h[6] : model->h[5]);
        finite(logits, model->h[6] ? model->h[6] : model->h[5]);
    }
}
} // namespace needle_cpu
