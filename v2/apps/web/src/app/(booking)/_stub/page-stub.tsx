type PageStubProps = {
  title: string;
  description: string;
};

export function PageStub({ title, description }: PageStubProps) {
  return (
    <section className="bg-brand-cream">
      <div className="container-page flex min-h-[60vh] flex-col items-start justify-center py-24">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-brand-text sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted-foreground">
          {description}
        </p>
      </div>
    </section>
  );
}
