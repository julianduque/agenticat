"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Download, FileText, FileJson, Image as ImageIcon, File, ExternalLink } from "lucide-react";
import Image from "next/image";

export type Artifact = {
  name?: string;
  description?: string;
  mimeType?: string;
  uri?: string;
  parts?: Array<{
    kind: string;
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
};

type ArtifactDisplayProps = {
  artifact: Artifact;
  className?: string;
};

function getFileIcon(mimeType?: string) {
  if (!mimeType) return <File className="h-4 w-4" />;

  if (mimeType.startsWith("image/")) {
    return <ImageIcon className="h-4 w-4" />;
  }
  if (mimeType === "application/json" || mimeType.includes("json")) {
    return <FileJson className="h-4 w-4" />;
  }
  if (mimeType.startsWith("text/")) {
    return <FileText className="h-4 w-4" />;
  }
  return <File className="h-4 w-4" />;
}

function ImageArtifact({ uri, alt }: { uri: string; alt?: string }) {
  return (
    <div className="relative group">
      <Image
        src={uri}
        alt={alt || "Artifact image"}
        className="max-w-full h-auto rounded-lg border border-border"
        width={800}
        height={600}
        unoptimized={uri.startsWith("blob:") || uri.startsWith("data:")}
      />
      <a
        href={uri}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Button variant="secondary" size="sm" className="h-7 gap-1.5">
          <ExternalLink className="h-3 w-3" />
          Open
        </Button>
      </a>
    </div>
  );
}

function DataArtifact({ data, mimeType }: { data: string; mimeType?: string }) {
  let jsonParsed: unknown = null;
  let decodedText: string | null = null;

  if (mimeType?.includes("json")) {
    try {
      jsonParsed = JSON.parse(atob(data));
    } catch {
      // Fall through to raw display
    }
  }

  if (jsonParsed !== null) {
    return (
      <pre className="bg-muted p-3 rounded-lg overflow-x-auto text-xs font-mono">
        {JSON.stringify(jsonParsed, null, 2)}
      </pre>
    );
  }

  try {
    const decoded = atob(data);
    if (decoded.length < 1000 && /^[\x20-\x7E\s]*$/.test(decoded)) {
      decodedText = decoded;
    }
  } catch {
    // Fall through
  }

  if (decodedText !== null) {
    return (
      <pre className="bg-muted p-3 rounded-lg overflow-x-auto text-xs font-mono">{decodedText}</pre>
    );
  }

  return (
    <div className="bg-muted p-3 rounded-lg">
      <p className="text-xs text-muted-foreground">Binary data ({data.length} bytes encoded)</p>
    </div>
  );
}

function FileArtifact({ uri, name, mimeType }: { uri: string; name?: string; mimeType?: string }) {
  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = uri;
    link.download = name || "download";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex items-center gap-3 bg-muted p-3 rounded-lg">
      {getFileIcon(mimeType)}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name || "Unnamed file"}</p>
        {mimeType && <p className="text-xs text-muted-foreground">{mimeType}</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={handleDownload} className="h-7 gap-1.5">
        <Download className="h-3 w-3" />
        Download
      </Button>
    </div>
  );
}

export function ArtifactDisplay({ artifact, className }: ArtifactDisplayProps) {
  const { name, description, mimeType, uri, parts } = artifact;

  // Render based on parts if available
  if (parts && parts.length > 0) {
    return (
      <Card className={cn("p-4 space-y-3", className)}>
        {name && (
          <div className="flex items-center gap-2">
            {getFileIcon(mimeType)}
            <span className="text-sm font-medium">{name}</span>
          </div>
        )}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <div className="space-y-2">
          {parts.map((part, index) => {
            if (part.kind === "text" && part.text) {
              return (
                <pre
                  key={index}
                  className="bg-muted p-3 rounded-lg overflow-x-auto text-xs font-mono"
                >
                  {part.text}
                </pre>
              );
            }
            if (part.kind === "data" && part.data) {
              return <DataArtifact key={index} data={part.data} mimeType={part.mimeType} />;
            }
            if (part.kind === "file" && part.uri) {
              if (part.mimeType?.startsWith("image/")) {
                return <ImageArtifact key={index} uri={part.uri} alt={name} />;
              }
              return (
                <FileArtifact key={index} uri={part.uri} name={name} mimeType={part.mimeType} />
              );
            }
            return null;
          })}
        </div>
      </Card>
    );
  }

  // Render based on direct properties
  if (uri) {
    if (mimeType?.startsWith("image/")) {
      return (
        <Card className={cn("p-4 space-y-3", className)}>
          {name && (
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              <span className="text-sm font-medium">{name}</span>
            </div>
          )}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          <ImageArtifact uri={uri} alt={name} />
        </Card>
      );
    }

    return (
      <Card className={cn("p-4 space-y-3", className)}>
        {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}
        <FileArtifact uri={uri} name={name} mimeType={mimeType} />
      </Card>
    );
  }

  // Fallback for unknown artifact structure
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-center gap-2 mb-2">
        <File className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{name || "Artifact"}</span>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </Card>
  );
}

type ArtifactListProps = {
  artifacts: Artifact[];
  className?: string;
};

export function ArtifactList({ artifacts, className }: ArtifactListProps) {
  if (!artifacts || artifacts.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Artifacts ({artifacts.length})
      </p>
      <div className="space-y-2">
        {artifacts.map((artifact, index) => (
          <ArtifactDisplay key={index} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}
