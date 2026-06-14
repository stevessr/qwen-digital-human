use candle_core::{Device, Result};

#[allow(dead_code)]
pub fn select_device() -> Result<Device> {
    // 优先尝试 CUDA
    if let Ok(device) = Device::new_cuda(0) {
        println!("Selected Device: CUDA GPU");
        return Ok(device);
    }

    // Metal (macOS 兜底)
    #[cfg(target_os = "macos")]
    if let Ok(device) = Device::new_metal(0) {
        println!("Selected Device: Metal GPU");
        return Ok(device);
    }

    // 如果 CUDA Toolkit 版本太新导致原生链接失败，
    // 我们在此处可以选择不带特性的 CPU 模式，或者后续接入 Vulkan
    println!("Selected Device: CPU (Optimized)");
    Ok(Device::Cpu)
}
