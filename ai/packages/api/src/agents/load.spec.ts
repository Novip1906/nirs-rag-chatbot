import { EModelEndpoint, parseEphemeralAgentId } from 'librechat-data-provider';
import type { LoadAgentDeps } from './load';
import { loadEphemeralAgent } from './load';
import { resolveSender } from './sender';

const deps: LoadAgentDeps = {
  getAgent: async () => null,
  getMCPServerTools: async () => null,
};

const baseReq = {
  user: { id: 'user-1' },
  config: {
    modelSpecs: { list: [{ name: 'my-opus-spec', label: 'Spec Label' }] },
  },
  body: {},
} as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

async function idFor(modelParameters: Record<string, unknown>) {
  const agent = await loadEphemeralAgent(
    {
      req: baseReq,
      spec: 'my-opus-spec',
      endpoint: 'my-custom-endpoint',
      model_parameters: modelParameters as never,
    },
    deps,
  );
  return agent?.id;
}

/**
 * Documents the #14253 Bug 2 mechanism: the ephemeral agent id (LangGraph node /
 * HITL checkpoint namespace) is derived from `sender = modelLabel ?? modelSpec.label`.
 * When the resume drops `modelLabel`, the id drifts and the paused checkpoint can't be
 * re-entered. The fix keeps `modelLabel` across resume (RESUME_CONTEXT_KEYS), so the
 * original and resumed ids stay equal.
 */
describe('loadEphemeralAgent ephemeral id stability (#14253 Bug 2)', () => {
  test('id changes when modelLabel is lost vs preserved', async () => {
    const withLabel = await idFor({ model: 'claude-opus-4', modelLabel: 'My Opus' });
    const withoutLabel = await idFor({ model: 'claude-opus-4' });
    expect(withLabel).toBeTruthy();
    expect(withoutLabel).toBeTruthy();
    // Original turn (has modelLabel) vs a resume that dropped it → different namespace.
    expect(withLabel).not.toEqual(withoutLabel);
  });

  test('id is stable when modelLabel is preserved across turns', async () => {
    const a = await idFor({ model: 'claude-opus-4', modelLabel: 'My Opus' });
    const b = await idFor({ model: 'claude-opus-4', modelLabel: 'My Opus' });
    expect(a).toEqual(b);
  });
});

/** Custom endpoints carry their configured name in `endpoint` at runtime,
 *  which `TEndpointOption` types as `EModelEndpoint`. */
const customEndpointOption = {
  endpoint: 'my-custom-endpoint' as EModelEndpoint,
  model: 'claude-opus-4',
};

const specWithKnowledgeBase = {
  ...baseReq,
  config: {
    modelSpecs: { list: [{ name: 'kb-spec', label: 'KB Spec', knowledgeBase: true }] },
  },
} as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

describe('loadEphemeralAgent knowledgeBase flag', () => {
  test('спек с knowledgeBase включает оба инструмента базы знаний', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: specWithKnowledgeBase,
        spec: 'kb-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).toEqual(expect.arrayContaining(['knowledge_search', 'knowledge_list']));
  });

  test('без флага инструменты базы знаний не подключаются', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: baseReq,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).not.toContain('knowledge_search');
    expect(agent?.tools).not.toContain('knowledge_list');
  });

  test('ephemeralAgent.knowledge_search сам по себе не подключает инструменты без modelSpec.knowledgeBase', async () => {
    const reqWithoutKnowledgeBase = {
      ...baseReq,
      body: { ephemeralAgent: { knowledge_search: true } },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

    const agent = await loadEphemeralAgent(
      {
        req: reqWithoutKnowledgeBase,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).not.toContain('knowledge_search');
    expect(agent?.tools).not.toContain('knowledge_list');
  });

  test('ephemeralAgent.knowledge_search === false снимает инструменты даже при modelSpec.knowledgeBase', async () => {
    const reqWithToggleOff = {
      ...specWithKnowledgeBase,
      body: { ephemeralAgent: { knowledge_search: false } },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

    const agent = await loadEphemeralAgent(
      {
        req: reqWithToggleOff,
        spec: 'kb-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).not.toContain('knowledge_search');
    expect(agent?.tools).not.toContain('knowledge_list');
  });

  test('без признака в запросе умолчание спека сохраняется', async () => {
    const reqWithoutFlag = {
      ...specWithKnowledgeBase,
      body: { ephemeralAgent: { web_search: false } },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

    const agent = await loadEphemeralAgent(
      {
        req: reqWithoutFlag,
        spec: 'kb-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).toEqual(expect.arrayContaining(['knowledge_search', 'knowledge_list']));
  });
});

const specWithWebSearch = {
  ...baseReq,
  config: {
    modelSpecs: { list: [{ name: 'ws-spec', label: 'WS Spec', webSearch: true }] },
  },
} as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

describe('loadEphemeralAgent webSearch flag', () => {
  test('modelSpec.webSearch включает инструмент по умолчанию', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: specWithWebSearch,
        spec: 'ws-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).toContain('web_search');
  });

  test('ephemeralAgent.web_search === false выключает инструмент даже при modelSpec.webSearch', async () => {
    const reqWithDisabledWebSearch = {
      ...specWithWebSearch,
      body: { ephemeralAgent: { web_search: false } },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

    const agent = await loadEphemeralAgent(
      {
        req: reqWithDisabledWebSearch,
        spec: 'ws-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).not.toContain('web_search');
  });

  test('ephemeralAgent.web_search === true включает инструмент без modelSpec.webSearch', async () => {
    const reqWithEnabledWebSearch = {
      ...baseReq,
      body: { ephemeralAgent: { web_search: true } },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

    const agent = await loadEphemeralAgent(
      {
        req: reqWithEnabledWebSearch,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).toContain('web_search');
  });
});

describe('loadEphemeralAgent instructions from policy system prompt', () => {
  test('промпт политики становится instructions, когда клиент ничего не прислал', async () => {
    const depsWithPolicy: LoadAgentDeps = {
      ...deps,
      getPolicySystemPrompt: async () => 'Промпт отдела',
    };
    const agent = await loadEphemeralAgent(
      {
        req: baseReq,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      depsWithPolicy,
    );
    expect(agent?.instructions).toBe('Промпт отдела');
  });

  test('промпт политики идёт перед клиентским promptPrefix через пустую строку', async () => {
    const depsWithPolicy: LoadAgentDeps = {
      ...deps,
      getPolicySystemPrompt: async () => 'Промпт отдела',
    };
    const reqWithPrefix = {
      ...baseReq,
      body: { promptPrefix: 'Личный префикс сотрудника' },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];
    const agent = await loadEphemeralAgent(
      {
        req: reqWithPrefix,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      depsWithPolicy,
    );
    expect(agent?.instructions).toBe('Промпт отдела\n\nЛичный префикс сотрудника');
  });

  test('пустой промпт политики не добавляет пустую строку и лишний перевод строки', async () => {
    const depsWithEmptyPolicy: LoadAgentDeps = {
      ...deps,
      getPolicySystemPrompt: async () => '',
    };
    const reqWithPrefix = {
      ...baseReq,
      body: { promptPrefix: 'Личный префикс сотрудника' },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];
    const agent = await loadEphemeralAgent(
      {
        req: reqWithPrefix,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      depsWithEmptyPolicy,
    );
    expect(agent?.instructions).toBe('Личный префикс сотрудника');
  });

  test('без getPolicySystemPrompt в зависимостях поведение как раньше — только клиентский промпт', async () => {
    const reqWithPrefix = {
      ...baseReq,
      body: { promptPrefix: 'Личный префикс сотрудника' },
    } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];
    const agent = await loadEphemeralAgent(
      {
        req: reqWithPrefix,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.instructions).toBe('Личный префикс сотрудника');
  });
});

/**
 * Регресс из прод-инцидента: модель без именной записи в `modelSpecs.list` (её спек
 * синтезируется на лету для клиента через `filterModelSpecsForUser`) не получала
 * инструменты базы знаний на сервере — `loadEphemeralAgent` искал `spec` только в сыром
 * `req.config.modelSpecs.list`, где синтетических записей нет. `deps.resolveModelSpec`
 * — тот же путь, каким пользуется `buildEndpointOption.js` в enforce-режиме.
 */
describe('loadEphemeralAgent синтетический спек (модель без именной записи в librechat.yaml)', () => {
  const syntheticSpec = {
    name: 'anthropic/claude-3-haiku',
    label: 'Claude 3 Haiku',
    knowledgeBase: true,
    preset: { endpoint: 'my-custom-endpoint', model: 'anthropic/claude-3-haiku' },
  };

  const reqWithoutNamedSpec = {
    ...baseReq,
    config: { modelSpecs: { list: [] } },
  } as unknown as Parameters<typeof loadEphemeralAgent>[0]['req'];

  test('подключает инструменты базы знаний, когда спек находится только через resolveModelSpec', async () => {
    const depsWithResolver: LoadAgentDeps = {
      ...deps,
      resolveModelSpec: async (_userId, _list, specName) =>
        specName === syntheticSpec.name ? syntheticSpec : null,
    };

    const agent = await loadEphemeralAgent(
      {
        req: reqWithoutNamedSpec,
        spec: syntheticSpec.name,
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: syntheticSpec.name } as never,
      },
      depsWithResolver,
    );

    expect(agent?.tools).toEqual(expect.arrayContaining(['knowledge_search', 'knowledge_list']));
  });

  test('без resolveModelSpec в зависимостях инструменты базы знаний не подключаются (поведение до фикса)', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: reqWithoutNamedSpec,
        spec: syntheticSpec.name,
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: syntheticSpec.name } as never,
      },
      deps,
    );

    expect(agent?.tools).not.toContain('knowledge_search');
    expect(agent?.tools).not.toContain('knowledge_list');
  });

  test('именной спек из сырого списка не идёт через resolveModelSpec', async () => {
    const resolveModelSpec = jest.fn(async () => null);
    const depsWithResolver: LoadAgentDeps = { ...deps, resolveModelSpec };

    await loadEphemeralAgent(
      {
        req: specWithKnowledgeBase,
        spec: 'kb-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      depsWithResolver,
    );

    expect(resolveModelSpec).not.toHaveBeenCalled();
  });
});

describe('loadEphemeralAgent → resolveSender parity', () => {
  test('the persisted sender matches the spec label encoded into the agent id', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: baseReq,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.id).toBeTruthy();
    const sender = resolveSender({
      agent: { id: agent?.id },
      specLabel: 'Spec Label',
      endpointOption: customEndpointOption,
    });
    expect(sender).toBe('Spec Label');
    expect(sender).toBe(parseEphemeralAgentId(agent?.id ?? '')?.sender);
  });

  test('a user modelLabel wins over the spec label in the persisted sender', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: baseReq,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4', modelLabel: 'My Opus' } as never,
      },
      deps,
    );
    const sender = resolveSender({
      agent: { id: agent?.id },
      specLabel: 'Spec Label',
      endpointOption: { ...customEndpointOption, modelLabel: 'My Opus' },
    });
    expect(sender).toBe('My Opus');
    expect(sender).toBe(parseEphemeralAgentId(agent?.id ?? '')?.sender);
  });
});

describe('loadEphemeralAgent export_file', () => {
  const exportReq: Parameters<typeof loadEphemeralAgent>[0]['req'] = {
    user: { id: 'user-1' },
    config: {
      modelSpecs: {
        list: [
          { name: 'my-opus-spec', label: 'Spec Label' },
          { name: 'export-spec', label: 'Export Spec', fileExport: true },
        ],
      },
    } as never,
  };

  test('спек с fileExport получает export_file', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: exportReq,
        spec: 'export-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).toContain('export_file');
  });

  test('спек без fileExport не объявляет export_file модели', async () => {
    const agent = await loadEphemeralAgent(
      {
        req: exportReq,
        spec: 'my-opus-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).not.toContain('export_file');
  });

  test('синтетический спек модели из каталога не получает export_file', async () => {
    const synthetic = { name: 'vendor/tool-less', label: 'Tool-less', knowledgeBase: false };
    const agent = await loadEphemeralAgent(
      {
        req: { ...exportReq, config: { modelSpecs: { list: [] } } as never },
        spec: 'vendor/tool-less',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'vendor/tool-less' } as never,
      },
      { ...deps, resolveModelSpec: async () => synthetic as never },
    );
    expect(agent?.tools).toEqual([]);
  });

  test('выключенные тумблеры запроса не снимают export_file', async () => {
    const req: Parameters<typeof loadEphemeralAgent>[0]['req'] = {
      ...exportReq,
      body: { ephemeralAgent: { web_search: false, execute_code: false, file_search: false } },
    };
    const agent = await loadEphemeralAgent(
      {
        req,
        spec: 'export-spec',
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );
    expect(agent?.tools).toEqual(['export_file']);
  });
});

describe('loadEphemeralAgent generate_image', () => {
  const imageSpecs = {
    list: [
      { name: 'plain-spec', label: 'Plain' },
      { name: 'image-spec', label: 'Image Spec', imageGeneration: true },
    ],
  };
  const load = (spec: string, config: Record<string, unknown>) =>
    loadEphemeralAgent(
      {
        req: { user: { id: 'user-1' }, config: config as never },
        spec,
        endpoint: 'my-custom-endpoint',
        model_parameters: { model: 'claude-opus-4' } as never,
      },
      deps,
    );

  test('спек с imageGeneration получает generate_image, когда генерация настроена', async () => {
    const agent = await load('image-spec', {
      modelSpecs: imageSpecs,
      config: { imageGeneration: { model: 'openai/gpt-5.4-image-2', apiKey: 'key' } },
    });
    expect(agent?.tools).toContain('generate_image');
  });

  test('без настройки генерации инструмент не объявляется', async () => {
    const agent = await load('image-spec', { modelSpecs: imageSpecs, config: {} });
    expect(agent?.tools).not.toContain('generate_image');
  });

  test('спек без imageGeneration не получает generate_image', async () => {
    const agent = await load('plain-spec', {
      modelSpecs: imageSpecs,
      config: { imageGeneration: { model: 'openai/gpt-5.4-image-2', apiKey: 'key' } },
    });
    expect(agent?.tools).not.toContain('generate_image');
  });
});
