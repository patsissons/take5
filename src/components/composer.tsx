import { ImagePlus, Sparkles, X } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { estimateCost, formatUsd } from "@/lib/cost";
import {
  defaultAspectRatio,
  defaultDuration,
  defaultResolution,
  imageRoles,
} from "@/lib/composer-defaults";
import { imageFromTransfer, isImageFile, toDataUrl } from "@/lib/image";
import type {
  ImageInput,
  ImageRole,
  VideoModel,
  VideoRequest,
} from "@/providers/types";

const MAX_IMAGES = 3;

interface Props {
  model: VideoModel;
  /** Prefill (remix). */
  initial?: Partial<VideoRequest>;
  busy: boolean;
  onGenerate: (req: VideoRequest) => void;
}

const ROLE_LABEL: Record<ImageRole, string> = {
  first_frame: "First frame",
  last_frame: "Last frame",
  reference: "Reference",
};

export function Composer({ model, initial, busy, onGenerate }: Props) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [duration, setDuration] = useState(
    initial?.duration ?? defaultDuration(model),
  );
  const [resolution, setResolution] = useState(
    initial?.resolution ?? defaultResolution(model),
  );
  const [aspectRatio, setAspectRatio] = useState(
    initial?.aspectRatio ?? defaultAspectRatio(model),
  );
  const [size, setSize] = useState(initial?.size ?? model.sizes?.[0]);
  const [audio, setAudio] = useState(initial?.audio ?? false);
  const [images, setImages] = useState<ImageInput[]>(initial?.images ?? []);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const roles = imageRoles(model);
  const useSize = !model.resolutions?.length && !!model.sizes?.length;

  const request = useMemo<VideoRequest>(
    () => ({
      model: model.id,
      prompt: prompt.trim(),
      duration,
      resolution: useSize ? undefined : resolution,
      aspectRatio: useSize ? undefined : aspectRatio,
      size: useSize ? size : undefined,
      audio: model.audio ? audio : undefined,
      images,
    }),
    [
      model,
      prompt,
      duration,
      resolution,
      aspectRatio,
      size,
      audio,
      images,
      useSize,
    ],
  );
  const estimate = estimateCost(model.pricing, request);
  const canSubmit = !busy && request.prompt.length > 0;

  const addImage = useCallback(
    async (file: File) => {
      if (!isImageFile(file)) return setImageError("That is not an image");
      if (images.length >= MAX_IMAGES)
        return setImageError(`At most ${MAX_IMAGES} images`);
      if (roles.length === 0)
        return setImageError("This model takes no images");
      try {
        const dataUrl = await toDataUrl(file);
        const used = new Set(images.map((image) => image.role));
        const role =
          roles.find((r) => r === "reference" || !used.has(r)) ?? roles[0]!;
        setImages((list) => [...list, { role, dataUrl }]);
        setImageError(null);
      } catch (error) {
        setImageError((error as Error).message || "Could not read that image");
      }
    },
    [images, roles],
  );

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = imageFromTransfer(event.dataTransfer);
    if (file) void addImage(file);
  };

  const onPaste = (event: ClipboardEvent) => {
    const file = imageFromTransfer(event.clipboardData);
    if (file) {
      event.preventDefault();
      void addImage(file);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      canSubmit
    ) {
      event.preventDefault();
      onGenerate(request);
    }
  };

  return (
    <form
      aria-label="Composer"
      className={`flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5 ${
        dragging ? "border-primary ring-2 ring-primary/30" : ""
      }`}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onGenerate(request);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <div className="grid gap-2">
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea
          id="prompt"
          placeholder="A corgi surfing a wave at golden hour, slow motion"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <p className="text-xs text-muted-foreground">
          ⌘/Ctrl + Enter to generate. Drop or paste an image to start from it.
        </p>
      </div>

      {roles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {images.map((image, i) => (
            <figure
              key={i}
              className="flex items-center gap-2 rounded-lg border p-1.5 pr-2"
            >
              <img
                src={image.dataUrl}
                alt=""
                className="size-12 rounded object-cover"
              />
              <select
                aria-label={`Image ${i + 1} role`}
                className="rounded-md border bg-background px-1.5 py-1 text-xs"
                value={image.role}
                onChange={(event) =>
                  setImages((list) =>
                    list.map((item, j) =>
                      j === i
                        ? { ...item, role: event.target.value as ImageRole }
                        : item,
                    ),
                  )
                }
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove image ${i + 1}`}
                onClick={() =>
                  setImages((list) => list.filter((_, j) => j !== i))
                }
              >
                <X />
              </Button>
            </figure>
          ))}
          {images.length < MAX_IMAGES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus data-icon="inline-start" /> Add image
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label="Choose an image"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addImage(file);
              event.target.value = "";
            }}
          />
          {imageError && (
            <p role="alert" className="text-xs text-destructive">
              {imageError}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="duration">Duration</Label>
          {model.durations?.length ? (
            <select
              id="duration"
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {model.durations.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          ) : (
            <input
              id="duration"
              type="number"
              min={1}
              max={60}
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value) || 1)}
            />
          )}
        </div>
        {useSize ? (
          <div className="grid gap-1">
            <Label htmlFor="size">Size</Label>
            <select
              id="size"
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={size}
              onChange={(event) => setSize(event.target.value)}
            >
              {model.sizes!.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            {model.resolutions?.length ? (
              <div className="grid gap-1">
                <Label htmlFor="resolution">Resolution</Label>
                <select
                  id="resolution"
                  className="h-8 rounded-lg border bg-background px-2 text-sm"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                >
                  {model.resolutions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {model.aspectRatios?.length ? (
              <div className="grid gap-1">
                <Label htmlFor="aspect">Aspect</Label>
                <select
                  id="aspect"
                  className="h-8 rounded-lg border bg-background px-2 text-sm"
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                >
                  {model.aspectRatios.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </>
        )}
        {model.audio && (
          <div className="grid gap-1">
            <Label htmlFor="audio">Audio</Label>
            <div className="flex h-8 items-center">
              <Switch id="audio" checked={audio} onCheckedChange={setAudio} />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="estimate">
          {estimate !== undefined
            ? `About ${formatUsd(estimate)}`
            : model.pricing?.kind === "unknown"
              ? model.pricing.note
              : "Price not listed"}
        </p>
        <Button type="submit" disabled={!canSubmit}>
          <Sparkles data-icon="inline-start" />
          {busy ? "Generating…" : "Generate"}
        </Button>
      </div>
    </form>
  );
}
