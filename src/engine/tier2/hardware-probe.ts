// Hardware probe for Tier 2 Path B. Decides whether this machine can host openai/privacy-filter
// on WebGPU, and with which quantisation. Pure feature detection — no DOM.

export interface HardwareThresholds {
  /** Minimum adapter maxStorageBufferBindingSize (bytes). */
  minStorageBinding: number;
  /** Minimum adapter maxBufferSize (bytes). */
  minBuffer: number;
  /** Minimum navigator.deviceMemory (GiB; Chrome caps the reported value at 8). */
  minDeviceMemoryGB: number;
}

export const DEFAULT_THRESHOLDS: HardwareThresholds = {
  minStorageBinding: 128 * 1024 * 1024,
  minBuffer: 256 * 1024 * 1024,
  minDeviceMemoryGB: 8,
};

export interface HardwareReport {
  webgpu: boolean;
  eligible: boolean;
  reason: string;
  dtype: 'q4f16' | 'q4';
  vendor: string;
  architecture: string;
  description: string;
  isFallbackAdapter: boolean;
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  shaderF16: boolean;
  deviceMemoryGB: number | null;
}

interface GpuAdapterLike {
  features: { has(name: string): boolean };
  limits: { maxStorageBufferBindingSize: number; maxBufferSize: number };
  info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
}

interface NavigatorLike {
  gpu?: { requestAdapter(opts?: { powerPreference?: string }): Promise<GpuAdapterLike | null> };
  deviceMemory?: number;
}

const MB = 1024 * 1024;

export async function probeHardware(thresholds: HardwareThresholds = DEFAULT_THRESHOLDS): Promise<HardwareReport> {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator;
  const base: HardwareReport = {
    webgpu: false,
    eligible: false,
    reason: '',
    dtype: 'q4',
    vendor: '',
    architecture: '',
    description: '',
    isFallbackAdapter: false,
    maxStorageBufferBindingSize: 0,
    maxBufferSize: 0,
    shaderF16: false,
    deviceMemoryGB: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
  };
  if (!nav?.gpu) return { ...base, reason: 'WebGPU not exposed (navigator.gpu missing — disabled by policy or unsupported)' };
  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (err) {
    return { ...base, reason: `requestAdapter failed: ${(err as Error).message}` };
  }
  if (!adapter) return { ...base, reason: 'No WebGPU adapter available' };
  const info = adapter.info ?? {};
  const report: HardwareReport = {
    ...base,
    webgpu: true,
    vendor: info.vendor ?? '',
    architecture: info.architecture ?? '',
    description: info.description ?? '',
    isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    shaderF16: adapter.features.has('shader-f16'),
  };
  report.dtype = report.shaderF16 ? 'q4f16' : 'q4';
  if (report.isFallbackAdapter) return { ...report, reason: 'Software (fallback) adapter — no real GPU' };
  if (report.maxStorageBufferBindingSize < thresholds.minStorageBinding) {
    return { ...report, reason: `maxStorageBufferBindingSize ${(report.maxStorageBufferBindingSize / MB).toFixed(0)} MB < ${thresholds.minStorageBinding / MB} MB` };
  }
  if (report.maxBufferSize < thresholds.minBuffer) {
    return { ...report, reason: `maxBufferSize ${(report.maxBufferSize / MB).toFixed(0)} MB < ${thresholds.minBuffer / MB} MB` };
  }
  if (report.deviceMemoryGB !== null && report.deviceMemoryGB < thresholds.minDeviceMemoryGB) {
    return { ...report, reason: `deviceMemory ${report.deviceMemoryGB} GB < ${thresholds.minDeviceMemoryGB} GB` };
  }
  const name = [report.vendor, report.architecture].filter(Boolean).join(' ') || 'GPU';
  return { ...report, eligible: true, reason: `${name} · ${(report.maxStorageBufferBindingSize / MB).toFixed(0)} MB binding · ${report.dtype}` };
}
