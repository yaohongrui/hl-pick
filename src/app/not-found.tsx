import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6">
      <div className="text-center">
        <div className="text-5xl font-semibold tracking-tight text-faint">404</div>
        <h1 className="mt-3 text-sm font-medium">没有找到这个页面</h1>
        <p className="mt-1 text-xs text-faint">
          请检查地址是否为 0x + 40 位十六进制。
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white"
        >
          返回刷卡
        </Link>
      </div>
    </main>
  );
}
