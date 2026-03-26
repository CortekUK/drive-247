"use client";

import { Monitor } from "lucide-react";
import Image from "next/image";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DASHBOARD_SLIDES } from "@/lib/constants";
import { useFadeIn } from "@/hooks/use-fade-in";

export function OperationsDashboard() {
  const videoRow = useFadeIn();
  const tabsRow = useFadeIn();

  return (
    <section id="features" className="bg-muted/50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section heading */}
        <div className="flex items-center justify-center gap-4">
          <div className="h-px w-12 bg-border" />
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Back-office control
          </p>
          <div className="h-px w-12 bg-border" />
        </div>

        <h2 className="mt-5 text-center text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
          Run your entire rental operation from{" "}
          <span className="text-indigo-600 dark:text-indigo-400">
            one dashboard
          </span>
        </h2>

        <p className="mx-auto mt-3 max-w-xl text-center leading-relaxed text-muted-foreground">
          Fleet, bookings, payments and analytics — unified in one system.
          No more switching between spreadsheets, payment platforms, and messaging apps.
        </p>

        {/* Video row */}
        <div
          ref={videoRow.ref}
          className={`mt-16 grid items-center gap-6 lg:grid-cols-5 ${videoRow.visible ? "fade-in-visible" : "fade-in-hidden"}`}
        >
          {/* Desktop mockup — takes 3 of 5 columns */}
          <div className="lg:col-span-3">
            <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/30 shadow-lg">
              <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-400/80" />
                  <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
                  <div className="h-3 w-3 rounded-full bg-green-400/80" />
                </div>
                <div className="mx-auto flex h-6 w-40 sm:w-64 items-center justify-center rounded-md bg-background px-3">
                  <span className="text-[11px] text-muted-foreground">
                    admin.drive247.com
                  </span>
                </div>
                <div className="w-[52px]" />
              </div>
              <video autoPlay loop muted playsInline className="w-full dark:hidden">
                <source src="/dashboard-video-v2.mp4" type="video/mp4" />
              </video>
              <video autoPlay loop muted playsInline className="hidden w-full dark:block">
                <source src="/dashboard-video-v2-dark.mp4" type="video/mp4" />
              </video>
            </div>
          </div>

          {/* Intro text — takes 2 of 5 columns */}
          <div className="lg:col-span-2">
            <h3 className="text-2xl font-bold tracking-tight">
              Your entire operation, one screen
            </h3>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              Fleet availability, vehicle status, bookings, extensions,
              payments, document verification, renter communication, and
              revenue reporting — all in one place.
            </p>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              No more switching between spreadsheets, payment platforms, and
              messaging apps. Every workflow an operator needs lives inside a
              single system, purpose-built for independent rental businesses.
            </p>
          </div>
        </div>

        {/* Tab carousel */}
        <div
          ref={tabsRow.ref}
          className={tabsRow.visible ? "fade-in-visible" : "fade-in-hidden"}
        >
          <Tabs defaultValue="fleet" className="mt-6 sm:mt-12">
            <TabsList
              variant="line"
              className="mx-auto grid h-auto w-full grid-cols-2 gap-2 bg-transparent sm:flex sm:flex-wrap sm:justify-center"
            >
              {DASHBOARD_SLIDES.map((slide) => (
                  <TabsTrigger
                    key={slide.id}
                    value={slide.id}
                    className="whitespace-nowrap rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all after:hidden last:col-span-2 last:mx-auto last:w-3/4 data-[state=active]:border-indigo-600/30 data-[state=active]:bg-indigo-600/[0.08] data-[state=active]:text-indigo-600 sm:px-4 sm:py-2 sm:text-sm sm:last:col-span-1 sm:last:w-auto dark:border-neutral-700 dark:data-[state=active]:border-indigo-400/50 dark:data-[state=active]:bg-indigo-400/[0.08] dark:data-[state=active]:text-indigo-400"
                  >
                    {slide.trigger}
                  </TabsTrigger>
                ))}
            </TabsList>

            {DASHBOARD_SLIDES.map((slide) => (
              <TabsContent
                key={slide.id}
                value={slide.id}
                className="animate-in fade-in duration-200"
              >
                <div className="relative mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
                  {/* Top accent line */}
                  <div className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent" />

                  <div className="grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-2">
                    {/* Screenshot or video */}
                    <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/30">
                      {"video" in slide && slide.video ? (
                        "videoDark" in slide && slide.videoDark ? (
                          <>
                            <video
                              autoPlay
                              loop
                              muted
                              playsInline
                              className="w-full dark:hidden"
                              onLoadedMetadata={(e) => {
                                e.currentTarget.playbackRate = 2;
                              }}
                            >
                              <source src={slide.video} type="video/mp4" />
                            </video>
                            <video
                              autoPlay
                              loop
                              muted
                              playsInline
                              className="hidden w-full dark:block"
                              onLoadedMetadata={(e) => {
                                e.currentTarget.playbackRate = 2;
                              }}
                            >
                              <source src={slide.videoDark} type="video/mp4" />
                            </video>
                          </>
                        ) : (
                          <video
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full"
                            onLoadedMetadata={(e) => {
                              e.currentTarget.playbackRate = 2;
                            }}
                          >
                            <source src={slide.video} type="video/mp4" />
                          </video>
                        )
                      ) : slide.image.startsWith("/placeholder") ? (
                        <div className="flex aspect-[4/3] items-center justify-center text-muted-foreground">
                          <div className="text-center">
                            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
                              <Monitor className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <p className="text-sm font-medium">{slide.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground/60">
                              Screenshot coming soon
                            </p>
                          </div>
                        </div>
                      ) : "imageDark" in slide && slide.imageDark ? (
                        <>
                          <Image
                            src={slide.image}
                            alt={slide.title}
                            width={1917}
                            height={992}
                            quality={100}
                            className="w-full dark:hidden"
                          />
                          <Image
                            src={slide.imageDark}
                            alt={slide.title}
                            width={1917}
                            height={992}
                            quality={100}
                            className="hidden w-full dark:block"
                          />
                        </>
                      ) : (
                        <Image
                          src={slide.image}
                          alt={slide.title}
                          width={1917}
                          height={992}
                          quality={100}
                          className="w-full"
                        />
                      )}
                    </div>

                    {/* Text & bullets */}
                    <div>
                      <h4 className="text-xl font-bold tracking-tight">
                        {slide.title}
                      </h4>
                      <p className="mt-2 text-muted-foreground leading-relaxed">
                        {slide.description}
                      </p>
                      {"body" in slide && slide.body && (
                        <p className="mt-2 text-muted-foreground leading-relaxed">
                          {slide.body}
                        </p>
                      )}
                      <ul className="mt-5 space-y-2">
                        {slide.bullets.map((bullet) => (
                          <li
                            key={bullet}
                            className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
                          >
                            <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                            <p className="text-sm font-medium">{bullet}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </section>
  );
}
