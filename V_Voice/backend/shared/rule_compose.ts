/**
 * R_10 룰 compose — fragment list + parent body_yaml → 평면 YAML.
 *
 * fragment_path 는 dotted path (예: 'templates.voice_studio_survey_build').
 * 각 fragment.generated_yaml 은 그 path 위치에 들어갈 YAML 값.
 * imports[] 는 자식 fragment id 배열 — 본 fragment 합성 전 자식을 본 fragment 안에
 *             1단계 inject (재귀 호출). Phase 1은 1단계만 의미 있음.
 *
 * 충돌 정책: fragment 우선 덮어쓰기 (위버 의도 우선).
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface Fragment {
  id: string;
  fragment_path: string;
  generated_yaml: string;
  imports: string[];
}

/** parent body_yaml에 fragments[] 를 dotted path 위치에 inject한 결과 YAML. */
export function composeYaml(parentYaml: string, fragments: Fragment[]): string {
  const root = parseYaml(parentYaml);
  if (!root || typeof root !== 'object') {
    throw new Error('composeYaml: parent YAML root must be object');
  }
  const obj = root as Record<string, unknown>;

  for (const f of fragments) {
    if (!f.generated_yaml || !f.fragment_path) continue;

    // 1단계 imports: 자식 fragment 의 generated_yaml 을 본 fragment 안에 미리 inject
    let effective = f.generated_yaml;
    if (f.imports.length > 0) {
      const children = fragments.filter((x) => f.imports.includes(x.id));
      if (children.length > 0) effective = composeYaml(effective, children);
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(effective);
    } catch (err) {
      throw new Error(
        `composeYaml: fragment ${f.id} (${f.fragment_path}) YAML parse failed — ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    setByPath(obj, splitPath(f.fragment_path), parsed);
  }

  return stringifyYaml(obj, { lineWidth: 0 });
}

/** path 위치의 기존 값을 새 값으로 덮어씀. 중간 키가 없으면 자동 생성. */
function setByPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i]!;
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}

/** dotted path 분해. 현재는 단순 split('.')만. 향후 array index([0]) 지원 가능. */
function splitPath(p: string): string[] {
  return p.split('.').filter((s) => s.length > 0);
}

/**
 * 평면 YAML 안의 최상위 `version:` 필드를 새 값으로 교체.
 * publish 시점에 위버가 입력한 version 으로 갈음하기 위함.
 * (compose 결과는 parent body_yaml의 version 그대로이므로 별도 교체 필요)
 */
export function replaceTopVersion(yaml: string, newVersion: string): string {
  // 들여쓰기 없는 ^version: 만 (templates 안의 version은 미건드림)
  const re = /^version:\s*['"]?[^'"\n]*['"]?\s*$/m;
  if (!re.test(yaml)) {
    // version 라인이 없으면 file 상단(rule_id 직후)에 추가
    return yaml.replace(/^(rule_id:\s*[^\n]+\n)/m, `$1version: '${newVersion}'\n`);
  }
  return yaml.replace(re, `version: '${newVersion}'`);
}
