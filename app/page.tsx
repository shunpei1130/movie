"use client";

import { useEffect, useMemo, useState } from "react";

type LoginType = "line" | "email";
type ActionType = "attend" | "purchase" | "watch";
type FanType = "現場型" | "収集型" | "視聴継続型" | "バランス型";
type AdminTab = "summary" | "fans" | "analysis" | "settings";

type User = {
  user_id: string;
  operator_user_id: string;
  display_name: string;
  login_type: LoginType;
  login_key: string;
  passport_id: string;
  target_id: string;
  registered_at: string;
  status: "active";
};

type Target = {
  target_id: string;
  operator_id: string;
  target_name: string;
  target_type: string;
  created_at: string;
};

type Event = {
  event_id: string;
  target_id: string;
  event_name: string;
  event_date: string;
  event_type: string;
  qr_token: string;
  created_at: string;
};

type Product = {
  product_id: string;
  target_id: string;
  product_name: string;
  product_category: string;
  code: string;
  created_at: string;
};

type WatchContent = {
  content_id: string;
  target_id: string;
  content_name: string;
  keyword: string;
  created_at: string;
};

type ActionRecord = {
  action_id: string;
  user_id: string;
  target_id: string;
  action_type: ActionType;
  ref_id: string;
  action_at: string;
  source_type: string;
  created_at: string;
};

type FanSummary = {
  user_id: string;
  target_id: string;
  total_actions: number;
  attend_count: number;
  purchase_count: number;
  watch_count: number;
  first_action_at: string | null;
  last_action_at: string | null;
  fan_type: FanType;
  churn_risk_flag: boolean;
  updated_at: string;
};

type DataStore = {
  users: User[];
  targets: Target[];
  events: Event[];
  products: Product[];
  watch_contents: WatchContent[];
  purchase_code_usage: Record<string, string>;
  action_records: ActionRecord[];
};

const STORAGE_KEY = "oshi-passport-mvp-v1";

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("ja-JP");
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ja-JP");
};

const monthKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const classifyFanType = (
  summary: Omit<FanSummary, "fan_type" | "churn_risk_flag" | "updated_at">,
): FanType => {
  const counts = [summary.attend_count, summary.purchase_count, summary.watch_count];
  const max = Math.max(...counts);
  const min = Math.min(...counts);

  if (summary.total_actions === 0) return "バランス型";
  if (max - min <= 1) return "バランス型";
  if (summary.attend_count === max) return "現場型";
  if (summary.purchase_count === max) return "収集型";
  if (summary.watch_count === max) return "視聴継続型";
  return "バランス型";
};

const calcChurnRisk = (actions: ActionRecord[]) => {
  if (actions.length === 0) return true;
  const sorted = [...actions].sort(
    (a, b) => new Date(a.action_at).getTime() - new Date(b.action_at).getTime(),
  );
  const now = Date.now();
  const last = new Date(sorted[sorted.length - 1].action_at).getTime();
  const noRecent30Days = now - last > 30 * 24 * 60 * 60 * 1000;

  let intervalFlag = false;
  if (sorted.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = new Date(sorted[i - 1].action_at).getTime();
      const curr = new Date(sorted[i].action_at).getTime();
      intervals.push(curr - prev);
    }
    const avg = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
    const currentGap = now - last;
    intervalFlag = currentGap > avg * 1.5;
  }

  const noSecondContact =
    sorted.length === 1 &&
    now - new Date(sorted[0].action_at).getTime() > 14 * 24 * 60 * 60 * 1000;

  return noRecent30Days || intervalFlag || noSecondContact;
};

const buildSummary = (user: User, records: ActionRecord[]): FanSummary => {
  const userActions = records.filter((record) => record.user_id === user.user_id);
  const attend_count = userActions.filter((a) => a.action_type === "attend").length;
  const purchase_count = userActions.filter((a) => a.action_type === "purchase").length;
  const watch_count = userActions.filter((a) => a.action_type === "watch").length;
  const sorted = [...userActions].sort(
    (a, b) => new Date(a.action_at).getTime() - new Date(b.action_at).getTime(),
  );

  const summaryBase = {
    user_id: user.user_id,
    target_id: user.target_id,
    total_actions: userActions.length,
    attend_count,
    purchase_count,
    watch_count,
    first_action_at: sorted[0]?.action_at ?? null,
    last_action_at: sorted[sorted.length - 1]?.action_at ?? null,
  };

  return {
    ...summaryBase,
    fan_type: classifyFanType(summaryBase),
    churn_risk_flag: calcChurnRisk(userActions),
    updated_at: new Date().toISOString(),
  };
};

const actionLabelMap: Record<ActionType, string> = {
  attend: "来場",
  purchase: "購入",
  watch: "視聴",
};

const actionIconMap: Record<ActionType, string> = {
  attend: "🎫",
  purchase: "🛍️",
  watch: "📺",
};

export default function Home() {
  const [store, setStore] = useState<DataStore | null>(null);
  const [loginType, setLoginType] = useState<LoginType>("line");
  const [displayName, setDisplayName] = useState("");
  const [loginKey, setLoginKey] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState("ライブ");

  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] = useState("グッズ");

  const [watchContentName, setWatchContentName] = useState("");
  const [watchKeyword, setWatchKeyword] = useState("");

  const [attendTokenInput, setAttendTokenInput] = useState("");
  const [purchaseCodeInput, setPurchaseCodeInput] = useState("");
  const [watchInput, setWatchInput] = useState("");

  const [adminTab, setAdminTab] = useState<AdminTab>("summary");
  const [fanFilter, setFanFilter] = useState("");
  const [fanTypeFilter, setFanTypeFilter] = useState<"all" | FanType>("all");
  const [churnOnly, setChurnOnly] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DataStore;
      setStore(parsed);
      if (parsed.users.length > 0) {
        setActiveUserId(parsed.users[0].user_id);
      }
      return;
    }

    const defaultTarget: Target = {
      target_id: createId(),
      operator_id: "operator-default",
      target_name: "サンプル推し",
      target_type: "VTuber",
      created_at: new Date().toISOString(),
    };

    const initialStore: DataStore = {
      users: [],
      targets: [defaultTarget],
      events: [],
      products: [],
      watch_contents: [],
      purchase_code_usage: {},
      action_records: [],
    };
    setStore(initialStore);
    setSelectedTargetId(defaultTarget.target_id);
  }, []);

  useEffect(() => {
    if (!store) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    if (!store || selectedTargetId) return;
    const firstTarget = store.targets[0];
    if (firstTarget) setSelectedTargetId(firstTarget.target_id);
  }, [selectedTargetId, store]);

  const activeUser = useMemo(() => {
    if (!store || !activeUserId) return null;
    return store.users.find((user) => user.user_id === activeUserId) ?? null;
  }, [activeUserId, store]);

  const summaries = useMemo(() => {
    if (!store) return [];
    return store.users.map((user) => buildSummary(user, store.action_records));
  }, [store]);

  const activeSummary = useMemo(() => {
    if (!activeUser) return null;
    return summaries.find((summary) => summary.user_id === activeUser.user_id) ?? null;
  }, [activeUser, summaries]);

  const activeTarget = useMemo(() => {
    if (!store || !activeUser) return null;
    return store.targets.find((target) => target.target_id === activeUser.target_id) ?? null;
  }, [activeUser, store]);

  const activeUserActions = useMemo(() => {
    if (!store || !activeUser) return [];
    return store.action_records
      .filter((record) => record.user_id === activeUser.user_id)
      .sort((a, b) => new Date(b.action_at).getTime() - new Date(a.action_at).getTime());
  }, [activeUser, store]);

  const actionsByMonth = useMemo(() => {
    return activeUserActions.reduce<Record<string, ActionRecord[]>>((acc, record) => {
      const key = monthKey(record.action_at);
      if (!acc[key]) acc[key] = [];
      acc[key].push(record);
      return acc;
    }, {});
  }, [activeUserActions]);

  const monthlyActionCount = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return activeUserActions.filter((record) => monthKey(record.action_at) === thisMonth).length;
  }, [activeUserActions]);

  const nextEvent = useMemo(() => {
    if (!store || !activeUser) return null;
    const now = Date.now();
    return store.events
      .filter((event) => event.target_id === activeUser.target_id)
      .filter((event) => new Date(event.event_date).getTime() >= now)
      .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())[0];
  }, [activeUser, store]);

  const adminSummary = useMemo(() => {
    if (!store) {
      return {
        totalFans: 0,
        monthlyActiveFans: 0,
        newRegistrations: 0,
        reengagementRate: 0,
        actions30d: 0,
      };
    }
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartTs = monthStart.getTime();

    const fansWithActionThisMonth = new Set(
      store.action_records
        .filter((record) => new Date(record.action_at).getTime() >= monthStartTs)
        .map((record) => record.user_id),
    );

    const actions30d = store.action_records.filter(
      (record) => now - new Date(record.action_at).getTime() <= 30 * 24 * 60 * 60 * 1000,
    ).length;

    const usersWithActions = store.users.map((user) => ({
      actions: store.action_records
        .filter((record) => record.user_id === user.user_id)
        .sort((a, b) => new Date(a.action_at).getTime() - new Date(b.action_at).getTime()),
    }));

    const hasSecondContact = usersWithActions.filter((item) => item.actions.length >= 2).length;
    const hasFirstContact = usersWithActions.filter((item) => item.actions.length >= 1).length;

    const reengagementRate = hasFirstContact > 0 ? (hasSecondContact / hasFirstContact) * 100 : 0;

    const newRegistrations = store.users.filter(
      (user) => new Date(user.registered_at).getTime() >= monthStartTs,
    ).length;

    return {
      totalFans: store.users.length,
      monthlyActiveFans: fansWithActionThisMonth.size,
      newRegistrations,
      reengagementRate,
      actions30d,
    };
  }, [store]);

  const eventStats = useMemo(() => {
    if (!store) return [];
    return store.events.map((event) => ({
      name: event.event_name,
      participants: store.action_records.filter(
        (record) => record.action_type === "attend" && record.ref_id === event.event_id,
      ).length,
    }));
  }, [store]);

  const productStats = useMemo(() => {
    if (!store) return [];
    return store.products.map((product) => ({
      name: product.product_name,
      count: store.action_records.filter(
        (record) => record.action_type === "purchase" && record.ref_id === product.product_id,
      ).length,
    }));
  }, [store]);

  const transitionRates = useMemo(() => {
    if (!store) {
      return {
        secondRate: 0,
        repurchaseAfterAttend: 0,
        revisitAfterPurchase: 0,
      };
    }

    const userActions = store.users.map((user) =>
      store.action_records
        .filter((record) => record.user_id === user.user_id)
        .sort((a, b) => new Date(a.action_at).getTime() - new Date(b.action_at).getTime()),
    );

    const secondRateBase = userActions.filter((records) => records.length >= 1).length;
    const secondRateNumerator = userActions.filter((records) => records.length >= 2).length;

    const attendUsers = userActions.filter((records) =>
      records.some((record) => record.action_type === "attend"),
    );
    const repurchaseAfterAttendNumerator = attendUsers.filter((records) => {
      const firstAttendIndex = records.findIndex((record) => record.action_type === "attend");
      return records
        .slice(firstAttendIndex + 1)
        .some((record) => record.action_type === "purchase");
    }).length;

    const purchaseUsers = userActions.filter((records) =>
      records.some((record) => record.action_type === "purchase"),
    );
    const revisitAfterPurchaseNumerator = purchaseUsers.filter((records) => {
      const firstPurchaseIndex = records.findIndex((record) => record.action_type === "purchase");
      return records
        .slice(firstPurchaseIndex + 1)
        .some((record) => record.action_type === "attend");
    }).length;

    return {
      secondRate: secondRateBase > 0 ? (secondRateNumerator / secondRateBase) * 100 : 0,
      repurchaseAfterAttend:
        attendUsers.length > 0
          ? (repurchaseAfterAttendNumerator / attendUsers.length) * 100
          : 0,
      revisitAfterPurchase:
        purchaseUsers.length > 0
          ? (revisitAfterPurchaseNumerator / purchaseUsers.length) * 100
          : 0,
    };
  }, [store]);

  const filteredFans = useMemo(() => {
    if (!store) return [];
    return summaries
      .map((summary) => ({
        summary,
        user: store.users.find((user) => user.user_id === summary.user_id),
      }))
      .filter((item): item is { summary: FanSummary; user: User } => Boolean(item.user))
      .filter((item) => item.user.display_name.includes(fanFilter))
      .filter((item) => (fanTypeFilter === "all" ? true : item.summary.fan_type === fanTypeFilter))
      .filter((item) => (churnOnly ? item.summary.churn_risk_flag : true))
      .sort((a, b) => {
        const aTs = a.summary.last_action_at ? new Date(a.summary.last_action_at).getTime() : 0;
        const bTs = b.summary.last_action_at ? new Date(b.summary.last_action_at).getTime() : 0;
        return bTs - aTs;
      });
  }, [churnOnly, fanFilter, fanTypeFilter, store, summaries]);

  if (!store) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
        <p>読み込み中...</p>
      </main>
    );
  }

  const saveStore = (next: DataStore, info: string) => {
    setStore(next);
    setMessage(info);
  };

  const handleRegister = () => {
    if (!displayName.trim() || !loginKey.trim() || !selectedTargetId) {
      setMessage("登録項目を入力してください。");
      return;
    }
    const exists = store.users.some((user) => user.login_key === loginKey.trim());
    if (exists) {
      setMessage("このログインIDは既に登録されています。");
      return;
    }

    const user: User = {
      user_id: createId(),
      operator_user_id: "operator-default-user",
      display_name: displayName.trim(),
      login_type: loginType,
      login_key: loginKey.trim(),
      passport_id: `PASS-${createId().slice(0, 8).toUpperCase()}`,
      target_id: selectedTargetId,
      registered_at: new Date().toISOString(),
      status: "active",
    };
    const next = { ...store, users: [...store.users, user] };
    saveStore(next, `登録完了: ${user.display_name} さん (${user.passport_id})`);
    setActiveUserId(user.user_id);
    setDisplayName("");
    setLoginKey("");
  };

  const addAction = (action: ActionType) => {
    if (!activeUser) {
      setMessage("先にファン登録またはユーザー選択をしてください。");
      return;
    }

    if (action === "attend") {
      const event = store.events.find((item) => item.qr_token === attendTokenInput.trim());
      if (!event) {
        setMessage("QRトークンが見つかりません。");
        return;
      }
      const duplicate = store.action_records.some(
        (record) =>
          record.user_id === activeUser.user_id &&
          record.action_type === "attend" &&
          record.ref_id === event.event_id,
      );
      if (duplicate) {
        setMessage("同一イベントの来場記録は1回のみです。");
        return;
      }
      const now = new Date().toISOString();
      const record: ActionRecord = {
        action_id: createId(),
        user_id: activeUser.user_id,
        target_id: activeUser.target_id,
        action_type: "attend",
        ref_id: event.event_id,
        action_at: now,
        source_type: "qr",
        created_at: now,
      };
      saveStore(
        { ...store, action_records: [record, ...store.action_records] },
        "来場を記録しました。",
      );
      setAttendTokenInput("");
      return;
    }

    if (action === "purchase") {
      const code = purchaseCodeInput.trim();
      const product = store.products.find((item) => item.code === code);
      if (!product) {
        setMessage("購入コードが見つかりません。");
        return;
      }
      if (store.purchase_code_usage[code]) {
        setMessage("この購入コードは既に使用済みです。");
        return;
      }
      const now = new Date().toISOString();
      const record: ActionRecord = {
        action_id: createId(),
        user_id: activeUser.user_id,
        target_id: activeUser.target_id,
        action_type: "purchase",
        ref_id: product.product_id,
        action_at: now,
        source_type: "code",
        created_at: now,
      };
      saveStore(
        {
          ...store,
          action_records: [record, ...store.action_records],
          purchase_code_usage: {
            ...store.purchase_code_usage,
            [code]: activeUser.user_id,
          },
        },
        "購入を記録しました。",
      );
      setPurchaseCodeInput("");
      return;
    }

    const keyword = watchInput.trim();
    const content = store.watch_contents.find((item) => item.keyword === keyword);
    if (!content) {
      setMessage("視聴キーワードが見つかりません。");
      return;
    }
    const sameDayDuplicate = store.action_records.some((record) => {
      if (
        record.user_id !== activeUser.user_id ||
        record.action_type !== "watch" ||
        record.ref_id !== content.content_id
      ) {
        return false;
      }
      const d1 = new Date(record.action_at);
      const d2 = new Date();
      return d1.toDateString() === d2.toDateString();
    });
    if (sameDayDuplicate) {
      setMessage("同一コンテンツの視聴記録は1日1回までです。");
      return;
    }
    const now = new Date().toISOString();
    const record: ActionRecord = {
      action_id: createId(),
      user_id: activeUser.user_id,
      target_id: activeUser.target_id,
      action_type: "watch",
      ref_id: content.content_id,
      action_at: now,
      source_type: "keyword",
      created_at: now,
    };
    saveStore(
      { ...store, action_records: [record, ...store.action_records] },
      "視聴を記録しました。",
    );
    setWatchInput("");
  };

  const addEvent = () => {
    if (!eventName.trim() || !eventDate || !selectedTargetId) {
      setMessage("イベント名・日付を入力してください。");
      return;
    }
    const event: Event = {
      event_id: createId(),
      target_id: selectedTargetId,
      event_name: eventName.trim(),
      event_date: eventDate,
      event_type: eventType,
      qr_token: `EVT-${createId().slice(0, 8).toUpperCase()}`,
      created_at: new Date().toISOString(),
    };
    saveStore({ ...store, events: [event, ...store.events] }, "イベントを作成しました。");
    setEventName("");
    setEventDate("");
  };

  const addProduct = () => {
    if (!productName.trim() || !selectedTargetId) {
      setMessage("商品名を入力してください。");
      return;
    }
    const product: Product = {
      product_id: createId(),
      target_id: selectedTargetId,
      product_name: productName.trim(),
      product_category: productCategory,
      code: `BUY-${createId().slice(0, 8).toUpperCase()}`,
      created_at: new Date().toISOString(),
    };
    saveStore({ ...store, products: [product, ...store.products] }, "商品コードを発行しました。");
    setProductName("");
  };

  const addWatchContent = () => {
    if (!watchContentName.trim() || !watchKeyword.trim() || !selectedTargetId) {
      setMessage("視聴コンテンツ名とキーワードを入力してください。");
      return;
    }
    const duplicated = store.watch_contents.some((content) => content.keyword === watchKeyword.trim());
    if (duplicated) {
      setMessage("その視聴キーワードは既に使われています。");
      return;
    }
    const content: WatchContent = {
      content_id: createId(),
      target_id: selectedTargetId,
      content_name: watchContentName.trim(),
      keyword: watchKeyword.trim(),
      created_at: new Date().toISOString(),
    };
    saveStore(
      { ...store, watch_contents: [content, ...store.watch_contents] },
      "視聴設定を追加しました。",
    );
    setWatchContentName("");
    setWatchKeyword("");
  };

  const firstActionDate = formatDate(activeSummary?.first_action_at ?? null);
  const daysFromFirstAction = activeSummary?.first_action_at
    ? Math.floor((Date.now() - new Date(activeSummary.first_action_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const shareText = `推し活パスポート\n応援タイプ: ${activeSummary?.fan_type ?? "-"}\n初応援から: ${daysFromFirstAction}日\n累計応援数: ${activeSummary?.total_actions ?? 0}`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h1 className="text-2xl font-bold text-white md:text-3xl">推し活パスポート MVP</h1>
          <p className="mt-2 text-sm text-slate-300">
            来場・購入・視聴を一元記録し、ファン向けには応援年表、運営向けには継続分析を提供します。
          </p>
          {message && (
            <p className="mt-3 rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
              {message}
            </p>
          )}
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-lg font-semibold">A. 登録画面（ファン）</h2>
            <div className="mt-4 grid gap-3">
              <label className="text-sm">
                ログイン方法
                <select
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2"
                  value={loginType}
                  onChange={(e) => setLoginType(e.target.value as LoginType)}
                >
                  <option value="line">LINEログイン</option>
                  <option value="email">メール + 認証コード</option>
                </select>
              </label>
              <label className="text-sm">
                表示名
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                ログインID（{loginType === "line" ? "LINE ID" : "メール"}）
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2"
                  value={loginKey}
                  onChange={(e) => setLoginKey(e.target.value)}
                />
              </label>
              <label className="text-sm">
                推し対象選択
                <select
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2"
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                >
                  {store.targets.map((target) => (
                    <option key={target.target_id} value={target.target_id}>
                      {target.target_name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleRegister}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400"
              >
                パスポートIDを発行して登録
              </button>
            </div>

            <div className="mt-4">
              <label className="text-sm">
                既存ユーザー切替
                <select
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2"
                  value={activeUserId ?? ""}
                  onChange={(e) => setActiveUserId(e.target.value || null)}
                >
                  <option value="">選択してください</option>
                  {store.users.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.display_name} ({user.passport_id})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-lg font-semibold">B. ホーム画面（ファン）</h2>
            {!activeUser || !activeSummary ? (
              <p className="mt-3 text-sm text-slate-300">登録後、ホーム情報が表示されます。</p>
            ) : (
              <div className="mt-3 grid gap-3 text-sm">
                <p>
                  <span className="text-slate-400">表示名:</span> {activeUser.display_name}
                </p>
                <p>
                  <span className="text-slate-400">パスポートID:</span> {activeUser.passport_id}
                </p>
                <p>
                  <span className="text-slate-400">推し対象:</span> {activeTarget?.target_name ?? "-"}
                </p>
                <p>
                  <span className="text-slate-400">今月の応援数:</span> {monthlyActionCount}
                </p>
                <p>
                  <span className="text-slate-400">最新の応援履歴:</span>{" "}
                  {activeUserActions[0]
                    ? `${actionLabelMap[activeUserActions[0].action_type]} (${formatDateTime(activeUserActions[0].action_at)})`
                    : "-"}
                </p>
                <p>
                  <span className="text-slate-400">応援タイプ:</span> {activeSummary.fan_type}
                </p>
                <p>
                  <span className="text-slate-400">次回イベント案内:</span>{" "}
                  {nextEvent ? `${nextEvent.event_name} (${formatDate(nextEvent.event_date)})` : "予定なし"}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h3 className="font-semibold">来場記録（QR）</h3>
            <input
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
              placeholder="チェックインQRトークン"
              value={attendTokenInput}
              onChange={(e) => setAttendTokenInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => addAction("attend")}
              className="mt-3 w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold hover:bg-emerald-400"
            >
              来場を記録
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h3 className="font-semibold">購入記録（コード入力）</h3>
            <input
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
              placeholder="購入連携コード"
              value={purchaseCodeInput}
              onChange={(e) => setPurchaseCodeInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => addAction("purchase")}
              className="mt-3 w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold hover:bg-sky-400"
            >
              購入を記録
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h3 className="font-semibold">視聴記録（キーワード）</h3>
            <input
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
              placeholder="視聴キーワード"
              value={watchInput}
              onChange={(e) => setWatchInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => addAction("watch")}
              className="mt-3 w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold hover:bg-violet-400"
            >
              視聴を記録
            </button>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-lg font-semibold">C. 応援年表画面</h2>
            {!activeSummary ? (
              <p className="mt-3 text-sm text-slate-300">ユーザーを選択すると年表が表示されます。</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <p>初応援日: {firstActionDate}</p>
                  <p>累計応援回数: {activeSummary.total_actions}</p>
                  <p>参加イベント数: {activeSummary.attend_count}</p>
                  <p>購入件数: {activeSummary.purchase_count}</p>
                  <p>視聴回数: {activeSummary.watch_count}</p>
                  <p>
                    直近の応援行動:{" "}
                    {activeSummary.last_action_at ? formatDate(activeSummary.last_action_at) : "-"}
                  </p>
                </div>

                <div className="mt-4 space-y-4">
                  {Object.entries(actionsByMonth).map(([month, records]) => (
                    <div key={month} className="rounded-lg border border-slate-700 p-3">
                      <h3 className="font-semibold">{month}</h3>
                      <ul className="mt-2 space-y-2 text-sm">
                        {records.map((record) => (
                          <li key={record.action_id} className="flex items-center justify-between gap-2">
                            <span>
                              {actionIconMap[record.action_type]} {actionLabelMap[record.action_type]}
                            </span>
                            <span>{formatDateTime(record.action_at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-lg font-semibold">D. シェアカード画面</h2>
            {!activeSummary ? (
              <p className="mt-3 text-sm text-slate-300">
                ユーザーを選択するとシェアカードを表示できます。
              </p>
            ) : (
              <>
                <div className="mt-3 rounded-xl border border-pink-400/40 bg-gradient-to-br from-pink-500/20 to-indigo-500/20 p-4 text-sm">
                  <p className="text-xs uppercase tracking-wider text-slate-300">推し活パスポート</p>
                  <p className="mt-2 text-lg font-bold">{activeUser?.display_name}</p>
                  <p>応援タイプ: {activeSummary.fan_type}</p>
                  <p>初応援からの日数: {daysFromFirstAction}日</p>
                  <p>累計応援回数: {activeSummary.total_actions}</p>
                  <p>今月の応援数: {monthlyActionCount}</p>
                  <p>推し対象名: {activeTarget?.target_name ?? "-"}</p>
                </div>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex rounded-lg bg-pink-500 px-4 py-2 text-sm font-semibold hover:bg-pink-400"
                >
                  SNS共有
                </a>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-semibold">運営向け画面</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["summary", "B. サマリー画面"],
              ["fans", "C. ファン一覧画面"],
              ["analysis", "D. イベント/商品分析"],
              ["settings", "E. 記録設定画面"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAdminTab(key as AdminTab)}
                className={`rounded-lg px-3 py-2 text-sm ${
                  adminTab === key ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {adminTab === "summary" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                総登録ファン数: {adminSummary.totalFans}
              </div>
              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                月間アクティブ: {adminSummary.monthlyActiveFans}
              </div>
              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                新規登録数: {adminSummary.newRegistrations}
              </div>
              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                再接触率: {adminSummary.reengagementRate.toFixed(1)}%
              </div>
              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                直近30日応援行動数: {adminSummary.actions30d}
              </div>
            </div>
          )}

          {adminTab === "fans" && (
            <div className="mt-4">
              <div className="mb-3 grid gap-2 md:grid-cols-3">
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  placeholder="表示名検索"
                  value={fanFilter}
                  onChange={(e) => setFanFilter(e.target.value)}
                />
                <select
                  className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  value={fanTypeFilter}
                  onChange={(e) => setFanTypeFilter(e.target.value as "all" | FanType)}
                >
                  <option value="all">タイプすべて</option>
                  <option value="現場型">現場型</option>
                  <option value="収集型">収集型</option>
                  <option value="視聴継続型">視聴継続型</option>
                  <option value="バランス型">バランス型</option>
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm">
                  <input type="checkbox" checked={churnOnly} onChange={(e) => setChurnOnly(e.target.checked)} />
                  離脱予兆のみ
                </label>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-left text-slate-300">
                      <th className="py-2 pr-3">表示名</th>
                      <th className="py-2 pr-3">最終応援日</th>
                      <th className="py-2 pr-3">累計応援回数</th>
                      <th className="py-2 pr-3">応援タイプ</th>
                      <th className="py-2 pr-3">離脱予兆</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFans.map(({ user, summary }) => (
                      <tr key={user.user_id} className="border-b border-slate-800">
                        <td className="py-2 pr-3">{user.display_name}</td>
                        <td className="py-2 pr-3">{formatDate(summary.last_action_at)}</td>
                        <td className="py-2 pr-3">{summary.total_actions}</td>
                        <td className="py-2 pr-3">{summary.fan_type}</td>
                        <td className="py-2 pr-3">{summary.churn_risk_flag ? "⚠️ あり" : "なし"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {adminTab === "analysis" && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-700 p-3">
                <h3 className="font-semibold">イベント別参加者数</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {eventStats.map((item) => (
                    <li key={item.name}>
                      {item.name}: {item.participants}
                    </li>
                  ))}
                  {eventStats.length === 0 && <li>データなし</li>}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-700 p-3">
                <h3 className="font-semibold">商品別記録件数</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {productStats.map((item) => (
                    <li key={item.name}>
                      {item.name}: {item.count}
                    </li>
                  ))}
                  {productStats.length === 0 && <li>データなし</li>}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                初回接触→2回目接触率: {transitionRates.secondRate.toFixed(1)}%
              </div>
              <div className="rounded-lg border border-slate-700 p-3 text-sm">
                イベント参加後の再購入率: {transitionRates.repurchaseAfterAttend.toFixed(1)}%
              </div>
              <div className="rounded-lg border border-slate-700 p-3 text-sm lg:col-span-2">
                購入後の再来場率: {transitionRates.revisitAfterPurchase.toFixed(1)}%
              </div>
            </div>
          )}

          {adminTab === "settings" && (
            <div className="mt-4 grid gap-6 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-700 p-3">
                <h3 className="font-semibold">イベント作成 + QR発行</h3>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  placeholder="イベント名"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                />
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  placeholder="イベント種別"
                />
                <button
                  type="button"
                  onClick={addEvent}
                  className="mt-2 w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold hover:bg-indigo-400"
                >
                  イベント登録
                </button>
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                  {store.events.map((event) => (
                    <li key={event.event_id}>
                      {event.event_name} / QR: {event.qr_token}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-700 p-3">
                <h3 className="font-semibold">商品コード発行</h3>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  placeholder="商品名"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  placeholder="カテゴリ"
                  value={productCategory}
                  onChange={(e) => setProductCategory(e.target.value)}
                />
                <button
                  type="button"
                  onClick={addProduct}
                  className="mt-2 w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold hover:bg-indigo-400"
                >
                  商品登録
                </button>
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                  {store.products.map((product) => (
                    <li key={product.product_id}>
                      {product.product_name} / CODE: {product.code}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-700 p-3">
                <h3 className="font-semibold">視聴記録設定</h3>
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  placeholder="コンテンツ名"
                  value={watchContentName}
                  onChange={(e) => setWatchContentName(e.target.value)}
                />
                <input
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm"
                  placeholder="視聴キーワード"
                  value={watchKeyword}
                  onChange={(e) => setWatchKeyword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={addWatchContent}
                  className="mt-2 w-full rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold hover:bg-indigo-400"
                >
                  視聴設定を追加
                </button>
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                  {store.watch_contents.map((content) => (
                    <li key={content.content_id}>
                      {content.content_name} / KEY: {content.keyword}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
