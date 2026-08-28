import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="text-5xl font-bold text-slate-300">404</div>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">
        That page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className="btn-primary mt-5 inline-flex">
        Back home
      </Link>
    </div>
  );
}
