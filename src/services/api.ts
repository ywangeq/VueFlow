import type { Project, JobRequest, UploadOptions } from "../domain/types";
async function request(
  path: string,
  options: RequestInit = {},
): Promise<Project> {
  const response = await fetch(`/api${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}
export const api = {
  importFile: (file: File, applyGraph = false) =>
    request(
      "/project/import?name=" +
        encodeURIComponent(file.name) +
        (applyGraph ? "&applyGraph=true" : ""),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      },
    ),
  exportFile: async () => {
    const response = await fetch("/api/project/export");
    if (!response.ok)
      throw new Error((await response.json()).error || "备份失败");
    return response.blob();
  },
  load: () => request("/project"),
  save: (project: Project) =>
    request("/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    }),
  queue: (segmentId: string, data: JobRequest) =>
    request(`/segments/${segmentId}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  cancel: (jobId: string) =>
    request(`/jobs/${jobId}/cancel`, { method: "POST" }),
  upload: (segmentId: string, file: File, options: UploadOptions) =>
    request(
      `/segments/${segmentId}/assets?${new URLSearchParams({ kind: options.kind, duration: String(options.duration), name: file.name, ...(options.jobId ? { jobId: options.jobId } : {}) })}`,
      {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      },
    ),
};
