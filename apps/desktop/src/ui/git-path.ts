export type GitPathParts = {
  fileName: string;
  directory: string;
  fullPath: string;
};

export function splitGitPath(path: string): GitPathParts {
  const fullPath = path || "";
  const normalized = fullPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.pop() || fullPath || "未命名文件";
  return {
    fileName,
    directory: parts.join("/"),
    fullPath,
  };
}

export function gitPathDirectoryLabel(directory: string): string {
  return directory || "项目根目录";
}
