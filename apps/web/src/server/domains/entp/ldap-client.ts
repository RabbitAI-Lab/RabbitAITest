/**
 * ENTP-002 LDAP 客户端：注入式 adapter（生产=ldapts；单测=fake 注入）。
 * 真实链路：bindDN+bindPassword 管理绑定 → userOu 下 (filterKey=账号) 搜索 → 用户 DN+密码二次 bind 验证。
 */
export interface LdapSearchEntry {
  dn: string;
  attrs: Record<string, string>;
}

export interface LdapAdapter {
  /** 管理绑定 + 搜索，返回条目（dn+映射后属性小写键） */
  bindAndSearch(cfg: {
    host: string;
    port: number;
    bindDn: string;
    bindPassword: string;
    userOu: string;
    filterKey: string;
    username: string;
  }): Promise<LdapSearchEntry[]>;
  /** 以用户 DN+密码二次 bind（密码验证） */
  bindAsUser(cfg: {
    host: string;
    port: number;
    userDn: string;
    password: string;
  }): Promise<boolean>;
}

/** 测试注入口（单测 fake 替换；生产默认 ldapts 实现）。 */
const g = globalThis as unknown as { __rabbitLdapAdapter?: LdapAdapter };
export function setLdapAdapter(adapter: LdapAdapter): void {
  g.__rabbitLdapAdapter = adapter;
}

async function adapter(): Promise<LdapAdapter> {
  if (g.__rabbitLdapAdapter) return g.__rabbitLdapAdapter;
  const { Client } = await import("ldapts");
  const impl: LdapAdapter = {
    async bindAndSearch(cfg) {
      const client = new Client({ url: `ldap://${cfg.host}:${cfg.port}`, timeout: 8000 });
      try {
        await client.bind(cfg.bindDn, cfg.bindPassword);
        const { searchEntries } = await client.search(cfg.userOu, {
          scope: "sub",
          filter: `(${cfg.filterKey}=${cfg.username})`,
        });
        return searchEntries.map((e) => ({
          dn: e.dn,
          attrs: Object.fromEntries(
            Object.entries(e)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k.toLowerCase(), String(v)]),
          ),
        }));
      } finally {
        await client.unbind().catch(() => {});
      }
    },
    async bindAsUser(cfg) {
      const client = new Client({ url: `ldap://${cfg.host}:${cfg.port}`, timeout: 8000 });
      try {
        await client.bind(cfg.userDn, cfg.password);
        return true;
      } catch {
        return false;
      } finally {
        await client.unbind().catch(() => {});
      }
    },
  };
  return impl;
}

/** LDAP 全链：bind+search → 二次 bind → 属性映射（username/name/email）。 */
export async function ldapAuthenticate(
  config: Record<string, unknown>,
  username: string,
  password: string,
): Promise<{ username: string; name: string; email: string } | null> {
  const cfg = {
    host: String(config.host ?? ""),
    port: Number(config.port ?? 389),
    bindDn: String(config.bindDn ?? ""),
    bindPassword: String(config.bindPassword ?? ""),
    userOu: String(config.userOu ?? ""),
    filterKey: String(config.filterKey ?? "uid"),
  };
  const a = await adapter();
  const entries = await a.bindAndSearch({ ...cfg, username });
  if (entries.length === 0) return null;
  const entry = entries[0]!;
  const okPwd = await a.bindAsUser({ host: cfg.host, port: cfg.port, userDn: entry.dn, password });
  if (!okPwd) return null;
  const mapping = (config.propMapping ?? {}) as Record<string, string>;
  return {
    username: entry.attrs[(mapping.username ?? "uid").toLowerCase()] ?? username,
    name: entry.attrs[(mapping.name ?? "cn").toLowerCase()] ?? username,
    email: entry.attrs[(mapping.email ?? "mail").toLowerCase()] ?? `${username}@ldap.local`,
  };
}

/** 测试连接用的轻量 bind+search（不校验用户密码）。 */
export async function ldapBindAndSearch(
  config: Record<string, unknown>,
  filterKey: string,
  username: string,
): Promise<{ entries: LdapSearchEntry[] }> {
  const cfg = {
    host: String(config.host ?? ""),
    port: Number(config.port ?? 389),
    bindDn: String(config.bindDn ?? ""),
    bindPassword: String(config.bindPassword ?? ""),
    userOu: String(config.userOu ?? ""),
    filterKey,
  };
  const a = await adapter();
  const entries = await a.bindAndSearch({ ...cfg, username });
  return { entries };
}
