#include "internal.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace needle_cpu {
template <class T> static T read(const uint8_t *p) {
    T x;
    std::memcpy(&x, p, sizeof x);
    return x;
}
static float half(const uint8_t *p) {
    uint16_t x = read<uint16_t>(p);
    int e = (x >> 10) & 31, m = x & 1023;
    float y = e == 31 ? (m ? NAN : INFINITY)
              : e     ? std::ldexp(1.f + m / 1024.f, e - 15)
                      : std::ldexp(float(m), -24);
    return x & 0x8000 ? -y : y;
}
Mapping::Mapping(const char *path, uint64_t offset, uint64_t length) {
#ifdef _WIN32
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, nullptr, 0);
    if (!count)
        throw std::runtime_error("Invalid UTF-8 archive path");
    std::vector<wchar_t> wide(size_t(count), wchar_t{});
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide.data(), count);
    HANDLE file = CreateFileW(wide.data(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    LARGE_INTEGER file_length{};
    if (file == INVALID_HANDLE_VALUE || !GetFileSizeEx(file, &file_length) || file_length.QuadPart <= 0 ||
        uint64_t(file_length.QuadPart) > SIZE_MAX) {
        if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
        throw std::runtime_error("Cannot open Needle archive");
    }
    const uint64_t file_size = uint64_t(file_length.QuadPart);
    if (offset > file_size || length > file_size - offset) {
        CloseHandle(file); throw std::invalid_argument("Archive section exceeds file");
    }
    size = size_t(length ? length : file_size - offset);
    SYSTEM_INFO info{}; GetSystemInfo(&info);
    const uint64_t start = offset / info.dwAllocationGranularity * info.dwAllocationGranularity;
    mapped_size = size + size_t(offset - start);
    HANDLE mapping = CreateFileMappingW(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
    void *view = mapping ? MapViewOfFile(mapping, FILE_MAP_READ, DWORD(start >> 32), DWORD(start), mapped_size) : nullptr;
    if (!view) {
        if (mapping) CloseHandle(mapping);
        CloseHandle(file);
        throw std::runtime_error("Cannot map model section");
    }
    file_handle = file; mapping_handle = mapping;
    mapped_base = static_cast<const uint8_t *>(view);
    data = mapped_base + size_t(offset - start);
#else
    fd = ::open(path, O_RDONLY);
    struct stat s{};
    if (fd < 0 || fstat(fd, &s) || s.st_size <= 0) {
        if (fd >= 0)
            ::close(fd);
        throw std::runtime_error("Cannot open Needle archive");
    }
    const uint64_t file_size = uint64_t(s.st_size);
    if (offset > file_size || length > file_size - offset) {
        ::close(fd); fd = -1; throw std::invalid_argument("Archive section exceeds file");
    }
    size = size_t(length ? length : file_size - offset);
    const auto page = uint64_t(sysconf(_SC_PAGESIZE));
    const uint64_t start = offset / page * page;
    mapped_size = size + size_t(offset - start);
    void *p = mmap(nullptr, mapped_size, PROT_READ, MAP_PRIVATE, fd, off_t(start));
    if (p == MAP_FAILED) {
        ::close(fd); fd = -1;
        throw std::runtime_error("Cannot map model section");
    }
    mapped_base = static_cast<const uint8_t *>(p);
    data = mapped_base + size_t(offset - start);
#endif
}
Mapping::~Mapping() {
#ifdef _WIN32
    if (mapped_base) UnmapViewOfFile(mapped_base);
    if (mapping_handle) CloseHandle(mapping_handle);
    if (file_handle) CloseHandle(file_handle);
#else
    if (mapped_base)
        munmap(const_cast<uint8_t *>(mapped_base), mapped_size);
    if (fd >= 0)
        ::close(fd);
#endif
}
float Tensor::scalar(size_t i) const {
    if (kind > 2 || i >= elements)
        throw std::invalid_argument("Floating parameter index outside tensor");
    return kind == 1 ? values[i] : read<float>(data + 4 * i);
}
void Tensor::row(size_t r, float *out, bool rotated) const {
    size_t cols = columns();
    if (kind == 4 || r >= elements / cols)
        throw std::invalid_argument("Tensor row outside shape");
    if (kind <= 2) {
        for (size_t i = 0; i < cols; ++i)
            out[i] = scalar(r * cols + i);
        return;
    }
    const size_t width = bits == 5 ? 2 : bits;
    const uint8_t *codes = data + r * padded * width / 8;
    std::array<float, 128> group_values;
    for (size_t g = 0; g < padded / group; ++g) {
        const float scale = values[r * (padded / group) + g];
        if (bits == 4) {
            std::array<float, 16> lookup;
            for (size_t i = 0; i < 16; ++i)
                lookup[i] = book[i] * scale;
            const uint8_t *p = codes + g * 64;
            for (size_t i = 0; i < 64; ++i) {
                group_values[2 * i] = lookup[p[i] & 15];
                group_values[2 * i + 1] = lookup[p[i] >> 4];
            }
        } else
            for (size_t i = 0; i < group; ++i) {
                size_t bit = (g * group + i) * width;
                unsigned index = codes[bit / 8] >> (bit % 8);
                if (bit % 8 + width > 8)
                    index |= unsigned(codes[bit / 8 + 1]) << (8 - bit % 8);
                index &= (1u << width) - 1;
                if (bits == 5 && index == 2)
                    throw std::invalid_argument("Invalid ternary code");
                group_values[i] = book[index] * scale;
            }
        if (!rotated)
            fwht(group_values.data(), group);
        size_t count = rotated ? group : std::min(size_t(group), cols - std::min(cols, g * group));
        std::copy_n(group_values.data(), count, out + std::min(cols, g * group));
    }
}
Model::Model(const char *path, uint64_t offset, uint64_t length)
    : mapping(std::make_shared<Mapping>(path, offset, length)) {
    uint16_t endian = 1;
    if (*reinterpret_cast<uint8_t *>(&endian) != 1)
        throw std::runtime_error("Little-endian host required");
    if (offset % 64)
        throw std::invalid_argument("Archive section exceeds file");
    length = mapping->size;
    if (length < 196)
        throw std::invalid_argument("Truncated Needle header");
    const uint8_t *base = mapping->data;
    std::memcpy(h.data(), base, 192);
    theta = read<float>(base + 192);
    if (h[0] != 0x05e12a84 || !h[1] || h[1] > 100000 || h[2] != 28)
        throw std::invalid_argument("Unsupported Needle archive header");
    size_t end = 308 + size_t(h[1]) * 44;
    if (end > length)
        throw std::invalid_argument("Truncated tensor directory");
    std::array<float, 28> books;
    for (size_t i = 0; i < books.size(); ++i) {
        books[i] = read<float>(base + 196 + 4 * i);
        finite(&books[i], 1);
    }
    for (size_t i = 0; i < h[1]; ++i) {
        const uint8_t *rec = base + 308 + i * 44;
        Tensor t;
        t.kind = rec[0];
        t.ndim = rec[1];
        t.elements = 1;
        if (!t.kind || t.kind > 4 || t.ndim > 4)
            throw std::invalid_argument("Invalid tensor type/rank");
        for (size_t j = 0; j < 4; ++j) {
            t.shape[j] = read<uint32_t>(rec + 4 + 4 * j);
            if (j < t.ndim) {
                if (!t.shape[j] || t.elements > SIZE_MAX / t.shape[j])
                    throw std::invalid_argument("Invalid tensor shape");
                t.elements *= t.shape[j];
            }
        }
        uint64_t start = read<uint64_t>(rec + 20), bytes = read<uint64_t>(rec + 28);
        if (start % 64 || start < end || start > length || bytes > length - start)
            throw std::invalid_argument("Invalid tensor bounds");
        end = size_t(start + bytes);
        t.data = base + start;
        t.bytes = size_t(bytes);
        t.group = read<uint32_t>(rec + 36);
        t.bits = read<uint32_t>(rec + 40);
        if (t.kind == 3) {
            if (t.ndim != 2 || t.group != 128 || !t.bits || t.bits > 5 ||
                t.shape[1] > UINT32_MAX - 127)
                throw std::invalid_argument("Unsupported CQ layout");
            t.padded = (t.shape[1] + 127) / 128 * 128;
            uint64_t packed = uint64_t(t.shape[0]) * t.padded * (t.bits == 5 ? 2 : t.bits) / 8;
            uint64_t norms = uint64_t(t.shape[0]) * (t.padded / 128);
            if (packed > bytes || norms > (bytes - packed) / 2 || packed + norms * 2 != bytes)
                throw std::invalid_argument("CQ payload size differs from shape");
            t.packed_bytes = size_t(packed);
            t.values.resize(size_t(norms));
            for (size_t k = 0; k < norms; ++k) {
                t.values[k] = half(t.data + packed + k * 2);
                if (!std::isfinite(t.values[k]) || t.values[k] < 0)
                    throw std::invalid_argument("Invalid CQ norm");
            }
            if (t.bits >= 2 && t.bits <= 4)
                std::copy_n(books.data() + (1u << t.bits) - 4, 1u << t.bits, t.book.data());
            else if (t.bits == 1) {
                t.book[1] = std::sqrt(2.f / 3.14159265358979323846f / 128.f);
                t.book[0] = -t.book[1];
            } else {
                t.book[0] = 0;
                t.book[1] = float(1.2240064 / std::sqrt(128.));
                t.book[3] = -t.book[1];
            }
        } else if (t.kind <= 2) {
            size_t width = t.kind == 1 ? 2 : 4;
            if (t.elements > SIZE_MAX / width || t.elements * width != bytes)
                throw std::invalid_argument("Floating payload size differs from shape");
            if (t.kind == 1) {
                t.values.resize(t.elements);
                for (size_t k = 0; k < t.elements; ++k)
                    t.values[k] = half(t.data + k * 2);
                finite(t.values.data(), t.elements);
            } else
                for (size_t k = 0; k < t.elements; ++k) {
                    float value = t.scalar(k);
                    finite(&value, 1);
                }
        }
        tensors.push_back(std::move(t));
    }
}
const Tensor &Model::tensor(int32_t i) const {
    if (i < 0 || size_t(i) >= tensors.size())
        throw std::invalid_argument("Tensor index outside archive");
    return tensors[size_t(i)];
}
void Model::validate_decoder() {
    std::lock_guard<std::mutex> lock(validation_mutex);
    if (!layers.empty())
        return;
    auto d = h[7], nh = h[8], nkh = h[9], l = h[10], qd = h[11], vd = h[12], hn = h[14], n = h[15];
    if (!d || d > 4096 || !nh || nh > 64 || !nkh || nh % nkh || !l || l > 64 || !qd || qd % 2 ||
        !vd || qd > 256 || vd > 256 || nh * uint64_t(qd) > 32768 || nh * uint64_t(vd) > 32768 ||
        !h[13] || h[13] > 65536 || hn < d || hn > 4096 || (hn & (hn - 1)) || !n || n > 8 || !h[3] ||
        h[3] > h[13] || h[4] != 8 || !h[5] || h[5] > 65536 || h[6] > h[5] || h[19] > 16 ||
        h[26] > 4 || h[31] > 16 || !std::isfinite(theta) || theta <= 0)
        throw std::invalid_argument("Unsupported Needle decoder geometry");
    auto expect = [&](uint32_t i, std::initializer_list<uint32_t> shape, bool matrix = false) {
        const Tensor &t = tensor(int32_t(i));
        if (t.ndim != shape.size() || !std::equal(shape.begin(), shape.end(), t.shape.begin()) ||
            t.kind > (matrix ? 3u : 2u))
            throw std::invalid_argument("Needle shape/type mismatch at index " + std::to_string(i));
    };
    expect(0, {h[5], d}, true);
    uint32_t cursor = 1;
    std::vector<Layer> parsed;
    // Match architecture._hada_blocks: floor(bit_length(hn-1)/2).
    uint32_t ba = 1u << (uint32_t(std::log2(hn)) / 2), bb = hn / ba;
    for (uint32_t i = 0; i < l; ++i) {
        Layer a{};
        a.norm = cursor++;
        expect(a.norm, {d});
        a.q = cursor++;
        expect(a.q, {nh * qd, d}, true);
        a.k = cursor++;
        expect(a.k, {nkh * qd, d}, true);
        a.v = cursor++;
        expect(a.v, {nkh * vd, d}, true);
        a.qt = a.kt = a.vt = 0;
        if (h[19]) {
            a.qt = cursor++;
            expect(a.qt, {h[19], nh * qd});
            a.kt = cursor++;
            expect(a.kt, {h[19], nkh * qd});
            a.vt = cursor++;
            expect(a.vt, {h[19], nkh * vd});
        }
        a.qnorm = cursor++;
        expect(a.qnorm, {qd});
        a.knorm = cursor++;
        expect(a.knorm, {qd});
        a.gate = cursor++;
        expect(a.gate, {nh * vd, d}, true);
        a.out = cursor++;
        expect(a.out, {d, nh * vd}, true);
        a.post = cursor++;
        expect(a.post, {d});
        a.agate = cursor++;
        expect(a.agate, {1});
        a.pre = cursor++;
        expect(a.pre, {d});
        a.diagonals = cursor;
        for (int j = 0; j < 5; ++j)
            expect(cursor++, {hn});
        a.factors = cursor;
        for (int j = 0; j < 3; ++j) {
            expect(cursor++, {ba, ba});
            expect(cursor++, {bb, bb});
        }
        a.cv = cursor++;
        expect(a.cv, {d, 8});
        a.cu = cursor++;
        expect(a.cu, {8, hn});
        parsed.push_back(a);
    }
    mhc = cursor;
    for (int j = 0; j < 3; ++j)
        expect(cursor++, {l});
    expect(cursor++, {l, n});
    expect(cursor++, {l, n});
    expect(cursor++, {l, n, n});
    expect(cursor++, {l * n, n * d}, true);
    expect(cursor++, {l * n, n * d}, true);
    expect(cursor++, {l * n * n, n * d}, true);
    perms = cursor;
    expect(cursor++, {hn});
    expect(cursor++, {hn});
    engrams = cursor;
    if (h[31] &&
        (!h[26] || !h[20] || !h[21] || h[21] > d || !h[22] || h[22] * uint64_t(h[21]) != d ||
         h[22] % h[26] || !h[23] || h[23] > 16 || !h[24] || h[24] > h[13]))
        throw std::invalid_argument("Invalid engram geometry");
    for (uint32_t i = 0; i < h[26]; ++i)
        if (!h[27 + i] || h[27 + i] > 64)
            throw std::invalid_argument("Invalid ngram order");
    for (uint32_t i = 0; i < h[31]; ++i) {
        if (h[32 + i] >= l || (i && h[32 + i] <= h[31 + i]))
            throw std::invalid_argument("Invalid engram sites");
        if (uint64_t(h[22]) * h[20] > UINT32_MAX)
            throw std::invalid_argument("Engram table rows overflow");
        expect(cursor++, {h[22] * h[20], h[21]}, true);
        expect(cursor++, {d, d}, true);
        expect(cursor++, {d, d}, true);
        expect(cursor++, {h[23], d});
    }
    final_norm = cursor++;
    expect(final_norm, {d});
    if (cursor >= tensors.size() || tensors.back().kind != 4)
        throw std::invalid_argument("Missing archive tokenizer");
    if (cursor + 1 < tensors.size()) {
        const Tensor &manifest = tensor(cursor++);
        if (manifest.kind > 2 || manifest.ndim != 1 || manifest.elements > 3)
            throw std::invalid_argument("Invalid probe head manifest");
        uint32_t previous = 0;
        for (size_t i = 0; i < manifest.elements; ++i) {
            float code = manifest.scalar(i);
            if (code < 1 || code > 3 || code != std::floor(code) || code <= previous)
                throw std::invalid_argument("Invalid probe head code");
            previous = uint32_t(code);
            const Tensor &p = tensor(cursor), &q = tensor(cursor + 2);
            uint32_t k = p.ndim == 3 ? p.shape[1] : p.shape[0] / (l + 1);
            uint32_t queries = q.shape[0];
            if (!k || k > 64 || !queries || queries > 64)
                throw std::invalid_argument("Invalid probe head geometry");
            if (p.ndim == 3) expect(cursor, {l + 1, k, d});
            else expect(cursor, {(l + 1) * k, d}, true);
            expect(cursor + 1, {l + 1, k});
            expect(cursor + 2, {queries, d}, true);
            expect(cursor + 3, {queries, l + 1, k});
            const Tensor &projection = tensor(cursor + 4);
            expect(cursor + 4, {projection.shape[0], queries * d}, true);
            expect(cursor + 5, {projection.shape[0]});
            if (code == 2) {
                if (projection.shape[0] != 1)
                    throw std::invalid_argument("Invalid confidence output width");
                confidence_head = cursor;
            }
            cursor += 6;
            if (code == 3) expect(cursor++, {3});
        }
        if (cursor + 1 != tensors.size())
            throw std::invalid_argument("Unexpected tensors after probe heads");
    }
    layers = std::move(parsed);
}
} // namespace needle_cpu
