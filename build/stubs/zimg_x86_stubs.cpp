// Stub implementations of zimg x86 dispatch functions for wasm builds.
// libzimg.a was compiled on an x86_64 host with ZIMG_X86 defined (configure
// detected the build machine as x86_64) even though --disable-simd was passed.
// The dispatch objects reference these symbols; stubs return nullptr so callers
// fall through to their portable fallback paths.
#include "zimg/common/x86/cpuinfo_x86.h"
#include "zimg/depth/x86/depth_convert_x86.h"
#include "zimg/depth/x86/dither_x86.h"
#include "zimg/resize/x86/resize_impl_x86.h"
#include "zimg/colorspace/x86/operation_impl_x86.h"
#include <memory>

namespace zimg {

// cpuinfo_x86
unsigned long cpu_cache_size_x86() noexcept { return 0; }
bool cpu_has_fast_f16_x86(CPUClass) noexcept { return false; }
bool cpu_requires_64b_alignment_x86(CPUClass) noexcept { return false; }

namespace depth {

left_shift_func select_left_shift_func_x86(PixelType, PixelType, CPUClass) { return nullptr; }
depth_convert_func select_depth_convert_func_x86(const PixelFormat &, const PixelFormat &, CPUClass) { return nullptr; }
depth_f16c_func select_depth_f16c_func_x86(bool, CPUClass) { return nullptr; }
bool needs_depth_f16c_func_x86(const PixelFormat &, const PixelFormat &, CPUClass) { return false; }

dither_convert_func select_ordered_dither_func_x86(const PixelFormat &, const PixelFormat &, CPUClass) { return nullptr; }
dither_f16c_func select_dither_f16c_func_x86(CPUClass) { return nullptr; }
bool needs_dither_f16c_func_x86(CPUClass) { return false; }
std::unique_ptr<graph::ImageFilter> create_error_diffusion_x86(unsigned, unsigned, const PixelFormat &, const PixelFormat &, CPUClass) { return nullptr; }

} // namespace depth

namespace resize {

std::unique_ptr<graph::ImageFilter> create_resize_impl_h_x86(const FilterContext &, unsigned, PixelType, unsigned, CPUClass) { return nullptr; }
std::unique_ptr<graph::ImageFilter> create_resize_impl_v_x86(const FilterContext &, unsigned, PixelType, unsigned, CPUClass) { return nullptr; }

} // namespace resize

namespace colorspace {

std::unique_ptr<Operation> create_matrix_operation_x86(const Matrix3x3 &, CPUClass) { return nullptr; }
std::unique_ptr<Operation> create_gamma_operation_x86(const TransferFunction &, const OperationParams &, CPUClass) { return nullptr; }
std::unique_ptr<Operation> create_inverse_gamma_operation_x86(const TransferFunction &, const OperationParams &, CPUClass) { return nullptr; }

} // namespace colorspace

} // namespace zimg
