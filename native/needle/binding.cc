#include <node_api.h>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>
#ifndef JNBOT_NEEDLE_UNSUPPORTED
#include "vendor/decoder/needle.h"
#endif

namespace {
void check(napi_status result) {
  if (result != napi_ok) throw std::runtime_error("Invalid native argument");
}
std::string text(napi_env env, napi_value value) {
  size_t count;
  check(napi_get_value_string_utf8(env, value, nullptr, 0, &count));
  std::vector<char> buffer(count + 1);
  check(napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &count));
  std::string result(buffer.data(), count);
  if (result.find('\0') != std::string::npos) throw std::runtime_error("Input contains NUL");
  return result;
}
uint64_t integer(napi_env env, napi_value value) {
  double result;
  check(napi_get_value_double(env, value, &result));
  if (!std::isfinite(result) || result < 0 || result > 9007199254740991. || result != std::floor(result))
    throw std::runtime_error("Expected a nonnegative safe integer");
  return uint64_t(result);
}
template<class T> T *array(napi_env env, napi_value value, napi_typedarray_type expected, size_t &size) {
  napi_typedarray_type type;
  napi_value buffer;
  size_t offset;
  void *data;
  check(napi_get_typedarray_info(env, value, &type, &size, &data, &buffer, &offset));
  if (type != expected) throw std::runtime_error("Invalid native array type");
  return static_cast<T *>(data);
}
#ifndef JNBOT_NEEDLE_UNSUPPORTED
struct State {
  np_handle *decoder = nullptr;
  void close() { np_free(decoder); decoder = nullptr; }
  ~State() { close(); }
};
void engine_check(int result, const char *error) {
  if (result < 0) throw std::runtime_error(error[0] ? error : "Local inference failed");
}
#endif
napi_value invoke(napi_env env, napi_callback_info info) {
#ifdef JNBOT_NEEDLE_UNSUPPORTED
  napi_throw_error(env, "AI_UNSUPPORTED_PLATFORM", "Local inference is unavailable on this architecture.");
  return nullptr;
#else
  try {
    size_t count = 4;
    napi_value args[4], result;
    check(napi_get_cb_info(env, info, &count, args, nullptr, nullptr));
    if (!count) throw std::runtime_error("Operation required");
    void *data;
    check(napi_get_instance_data(env, &data));
    auto &state = *static_cast<State *>(data);
    const auto op = text(env, args[0]);
    char error[2048] = {};
    check(napi_get_undefined(env, &result));
    if (op == "close") {
      state.close();
    } else if (op == "load" && count == 4) {
      const auto file = text(env, args[1]);
      const auto offset = integer(env, args[2]), length = integer(env, args[3]);
      state.close();
      state.decoder = np_load(file.c_str(), offset, length, 4, error, sizeof error);
      if (!state.decoder) throw std::runtime_error(error);
    } else if (!state.decoder) {
      throw std::runtime_error("Model not loaded");
    } else if (op == "window" && count == 2) {
      engine_check(np_set_window(state.decoder, size_t(integer(env, args[1])), error, sizeof error), error);
    } else if (op == "prefix" && count == 2) {
      engine_check(np_set_prefix(state.decoder, size_t(integer(env, args[1])), error, sizeof error), error);
    } else if (op == "eval" && count == 3) {
      size_t input_size, output_size;
      auto input = array<int32_t>(env, args[1], napi_int32_array, input_size);
      auto output = array<float>(env, args[2], napi_float32_array, output_size);
      engine_check(np_eval(state.decoder, input, input_size, output, output_size, error, sizeof error), error);
    } else if (op == "confidence" && count == 1) {
      float confidence = 0;
      const int available = np_confidence(state.decoder, &confidence, error, sizeof error);
      engine_check(available, error);
      if (available) check(napi_create_double(env, confidence, &result));
      else check(napi_get_null(env, &result));
    } else if (op == "reset" && count == 1) {
      np_reset(state.decoder);
    } else if (op == "stats" && count == 1) {
      np_memory_info memory{};
      engine_check(np_memory_stats(state.decoder, &memory, error, sizeof error), error);
      check(napi_create_object(env, &result));
      auto property = [&](const char *name, double number) {
        napi_value value;
        check(napi_create_double(env, number, &value));
        check(napi_set_named_property(env, result, name, value));
      };
      property("mappedWeightsBytes", double(memory.mapped_weights_bytes));
      property("workspaceBytes", double(memory.decoded_workspace_bytes));
      property("kvBytes", double(memory.kv_bytes));
      property("prefixReusedTokens", double(np_prefix_reused(state.decoder)));
    } else {
      throw std::runtime_error("Invalid native operation or arguments");
    }
    return result;
  } catch (const std::exception &error) {
    napi_throw_error(env, "AI_ENGINE", error.what());
    return nullptr;
  }
#endif
}
napi_value initialize(napi_env env, napi_value exports) {
#ifndef JNBOT_NEEDLE_UNSUPPORTED
  auto state = std::make_unique<State>();
  if (napi_set_instance_data(env, state.get(), [](napi_env, void *p, void *) { delete static_cast<State *>(p); }, nullptr) != napi_ok) return nullptr;
  state.release();
#endif
  napi_value function;
  if (napi_create_function(env, "invoke", NAPI_AUTO_LENGTH, invoke, nullptr, &function) != napi_ok) return nullptr;
  if (napi_set_named_property(env, exports, "invoke", function) != napi_ok) return nullptr;
  return exports;
}
}
#ifdef JNBOT_NEEDLE_LINKED
static napi_module linked_module = { NAPI_MODULE_VERSION, 2, __FILE__, initialize, "jnbot_needle", nullptr, {0} };
extern "C" void jnbot_needle_register() {
  static bool registered = false;
  if (!registered) { registered = true; napi_module_register(&linked_module); }
}
#else
NAPI_MODULE(jnbot_needle, initialize)
#endif
