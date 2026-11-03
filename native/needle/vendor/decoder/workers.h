#pragma once
#include <atomic>
#include <cfenv>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>

namespace needle_cpu {
// Synchronous, allocation-free row jobs. Kernels must not throw or submit nested jobs.
// Decode projections take tens of microseconds, less than a condition-variable
// wake-up, so idle workers spin briefly before they sleep.
class ProjectionWorkers {
  public:
    using Function = void (*)(void *, size_t, size_t);
    explicit ProjectionWorkers(size_t threads);
    ~ProjectionWorkers();
    ProjectionWorkers(const ProjectionWorkers &) = delete;
    ProjectionWorkers &operator=(const ProjectionWorkers &) = delete;
    // Rows are split into contiguous ranges whose bounds are multiples of grain.
    void run(size_t rows, void *context, Function function, size_t grain = 4);

  private:
    std::vector<std::thread> workers;
    std::mutex mutex;
    std::condition_variable ready;
    std::atomic<bool> stopping{false};
    std::atomic<uint64_t> generation{0};
    std::atomic<size_t> pending{0}, sleepers{0};
    size_t count = 0, grain = 4;
    void *context = nullptr;
    Function function = nullptr;
    std::fenv_t environment;
    void work(size_t rank);
    void wake();
    void stop();
};
} // namespace needle_cpu
