#include "workers.h"
#include <algorithm>
#include <chrono>
#if defined(_MSC_VER)
#include <intrin.h>
#elif defined(__x86_64__) || defined(__i386__)
#include <immintrin.h>
#endif

namespace needle_cpu {
namespace {
// Idle time after which a worker stops spinning and sleeps until the next job.
constexpr auto spin_budget = std::chrono::microseconds(500);

inline void relax() {
#if defined(_MSC_VER)
    YieldProcessor();
#elif defined(__x86_64__) || defined(__i386__)
    _mm_pause();
#elif defined(__aarch64__) || defined(__arm__)
    __asm__ __volatile__("yield");
#endif
}
} // namespace

ProjectionWorkers::ProjectionWorkers(size_t threads) {
    threads = std::min(threads, size_t(std::max(1u, std::thread::hardware_concurrency())));
    workers.reserve(threads > 0 ? threads - 1 : 0);
    try {
        for (size_t rank = 1; rank < threads; ++rank)
            workers.emplace_back([this, rank] { work(rank); });
    } catch (...) {
        stop();
        throw;
    }
}
ProjectionWorkers::~ProjectionWorkers() { stop(); }

void ProjectionWorkers::wake() {
    // Pairs with the sleeper count a worker publishes before its final check.
    if (sleepers.load() == 0)
        return;
    { std::lock_guard<std::mutex> lock(mutex); }
    ready.notify_all();
}

void ProjectionWorkers::stop() {
    stopping.store(true);
    { std::lock_guard<std::mutex> lock(mutex); }
    ready.notify_all();
    for (auto &worker : workers)
        worker.join();
}

void ProjectionWorkers::run(size_t rows, void *job, Function fn, size_t step) {
    if (workers.empty()) {
        fn(job, 0, rows);
        return;
    }
    context = job;
    function = fn;
    count = rows;
    grain = step;
    std::fegetenv(&environment);
    pending.store(workers.size(), std::memory_order_relaxed);
    generation.fetch_add(1);
    wake();
    const size_t blocks = (rows + step - 1) / step, team = workers.size() + 1;
    fn(job, 0, std::min(rows, (blocks / team) * step));
    while (pending.load(std::memory_order_acquire))
        relax();
}

void ProjectionWorkers::work(size_t rank) {
    uint64_t seen = 0;
    for (;;) {
        auto idle = std::chrono::steady_clock::now();
        for (size_t spins = 0; generation.load(std::memory_order_acquire) == seen && !stopping.load(std::memory_order_relaxed); ++spins) {
            relax();
            if ((spins & 1023) == 1023 && std::chrono::steady_clock::now() - idle > spin_budget) {
                std::unique_lock<std::mutex> lock(mutex);
                sleepers.fetch_add(1);
                ready.wait(lock, [&] { return stopping.load() || generation.load() != seen; });
                sleepers.fetch_sub(1);
                idle = std::chrono::steady_clock::now();
            }
        }
        if (stopping.load())
            return;
        seen = generation.load(std::memory_order_acquire);
        const size_t rows = count, step = grain, blocks = (rows + step - 1) / step, team = workers.size() + 1;
        const size_t begin = std::min(rows, (blocks * rank / team) * step);
        const size_t end = std::min(rows, (blocks * (rank + 1) / team) * step);
        std::fenv_t saved;
        std::fegetenv(&saved);
        std::fesetenv(&environment);
        function(context, begin, end);
        std::fesetenv(&saved);
        pending.fetch_sub(1, std::memory_order_release);
    }
}
} // namespace needle_cpu
