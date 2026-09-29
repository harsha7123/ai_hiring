import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-20 pt-10 sm:pt-20">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
