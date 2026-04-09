import { useState } from "react";

import { APP_API_PATH } from "@/lib/api-paths";
import { getBrowserOrigin } from "@/lib/browser-origin";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";

import { CONNECTOR_BASE_URL_TOKEN, GUIDE_CONTENT } from "./connection-guides";
import type { GuideLocaleContent, GuideStep } from "./connection-guides";
import type { ProviderType } from "./data-source-provider-metadata";

interface GuideSectionProps {
  step: GuideStep;
  index: number;
}

function GuideSection(props: GuideSectionProps) {
  const hasImage = Boolean(props.step.imageSrc);
  const layoutClassName = hasImage
    ? "grid gap-5 rounded-xl border p-4 md:grid-cols-2"
    : "rounded-xl border p-4";
  const textClassName = props.step.reverse ? "md:order-2" : "";
  const imageClassName = props.step.reverse ? "md:order-1" : "";
  const renderedCode = props.step.code?.replaceAll(
    CONNECTOR_BASE_URL_TOKEN,
    `${getBrowserOrigin()}${APP_API_PATH}`
  );

  return (
    <section className={layoutClassName}>
      <div className={textClassName}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {props.index + 1}
        </p>
        <h3 className="mb-3 text-lg font-semibold">{props.step.title}</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          {props.step.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {props.step.bullets && props.step.bullets.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {props.step.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        )}
        {renderedCode && (
          <pre className="mt-3 overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-relaxed">
            {renderedCode}
          </pre>
        )}
        {props.step.note && (
          <p className="mt-3 rounded-md border bg-muted/60 p-2 text-xs text-muted-foreground">
            {props.step.note}
          </p>
        )}
      </div>
      {hasImage && props.step.imageSrc && props.step.imageAlt && (
        <div className={imageClassName}>
          <img
            src={props.step.imageSrc}
            alt={props.step.imageAlt}
            className="h-auto max-h-[400px] w-full rounded-lg border object-contain"
          />
        </div>
      )}
    </section>
  );
}

function GuideLocaleView(props: {
  content?: GuideLocaleContent;
  providerLabel: string;
}) {
  if (!props.content) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <p>
          {props.providerLabel} 가이드는 아직 wb-landing 원문 페이지가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4">
        <h2 className="text-lg font-semibold">{props.content.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {props.content.description}
        </p>
      </section>

      {props.content.steps.map((step, index) => (
        <GuideSection key={step.title} step={step} index={index} />
      ))}

      {props.content.closingTitle && (
        <section className="rounded-xl border p-4">
          <h3 className="text-base font-semibold">
            {props.content.closingTitle}
          </h3>
          {props.content.closingDescription && (
            <p className="mt-2 text-sm text-muted-foreground">
              {props.content.closingDescription}
            </p>
          )}
          {props.content.closingNote && (
            <p className="mt-2 rounded-md border bg-muted/60 p-2 text-xs text-muted-foreground">
              {props.content.closingNote}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

interface DataSourceConnectionGuideDialogProps {
  provider: ProviderType;
}

export function DataSourceConnectionGuideDialog(
  props: DataSourceConnectionGuideDialogProps
) {
  const [open, setOpen] = useState(false);
  const guide = GUIDE_CONTENT[props.provider];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            How to connect
          </Button>
        }
      />
      <DialogContent
        overlayClassName="bg-black/35 supports-backdrop-filter:backdrop-blur-lg"
        className="h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden gap-0 p-0 sm:max-w-[96vw]"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{guide.providerLabel} Connection Guide</DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue="en"
          className="flex h-full min-h-0 flex-col overflow-hidden px-5 pb-5"
        >
          <TabsList className="mt-4 w-full max-w-[320px]">
            <TabsTrigger value="en" className="flex-1">
              English
            </TabsTrigger>
            <TabsTrigger value="ko" className="flex-1">
              한국어
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="en"
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <GuideLocaleView
              content={guide.en}
              providerLabel={guide.providerLabel}
            />
          </TabsContent>

          <TabsContent
            value="ko"
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <GuideLocaleView
              content={guide.ko}
              providerLabel={guide.providerLabel}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
