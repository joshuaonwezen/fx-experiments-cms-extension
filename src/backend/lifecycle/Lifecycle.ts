import {
  AuthorizationGrantResult,
  CanUninstallResult,
  Lifecycle as AppLifecycle,
  LifecycleResult,
  LifecycleSettingsResult,
  logger,
  storage,
  SubmittedFormData,
  Request as AppRequest,
} from '@zaiusinc/app-sdk';

import {CmsClient} from '../lib/cms';
import {FxClient} from '../lib/fx';
import {ApiError} from '../lib/http';
import {CmsSettings, DEFAULT_ENVIRONMENT, FxSettings, toFxConfig} from '../lib/settings';

function text(formData: SubmittedFormData, key: string): string {
  const value = formData[key];
  return typeof value === 'string' ? value.trim() : '';
}

export class Lifecycle extends AppLifecycle {
  public async onInstall(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onUpgrade(_fromVersion: string): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onFinalizeUpgrade(_fromVersion: string): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onAfterUpgrade(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async canUninstall(): Promise<CanUninstallResult> {
    return {uninstallable: true};
  }

  public async onUninstall(): Promise<LifecycleResult> {
    return {success: true};
  }

  public async onSettingsForm(
    section: string,
    action: string,
    formData: SubmittedFormData,
  ): Promise<LifecycleSettingsResult> {
    const result = new LifecycleSettingsResult();
    try {
      if (section === 'fx' && action === 'saveFx') return await this.saveFx(formData, result);
      if (section === 'cms' && action === 'saveCms') return await this.saveCms(formData, result);
    } catch (error) {
      logger.error('Settings save failed', error);
      return result.addToast('danger', 'Could not save settings. Try again.');
    }
    logger.warn('Unsupported section-action combination:', section, action);
    return result;
  }

  private async saveFx(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await storage.settings.get<FxSettings>('fx');
    const next: FxSettings = {
      // A secret field comes back blank when the editor didn't retype it - keep the stored one.
      apiToken: text(formData, 'apiToken') || previous.apiToken || '',
      projectId: text(formData, 'projectId'),
      environmentKey: text(formData, 'environmentKey') || DEFAULT_ENVIRONMENT,
      audienceIds: text(formData, 'audienceIds'),
    };
    if (!next.apiToken) return result.addError('apiToken', 'Required.');
    if (!/^\d+$/.test(next.projectId ?? '')) return result.addError('projectId', 'Numeric project ID required.');

    try {
      const environments = await new FxClient(toFxConfig(next)).listEnvironments();
      if (!environments.includes(next.environmentKey!)) {
        return result.addError(
          'environmentKey',
          `Not in this project. Available: ${environments.join(', ') || 'none'}.`,
        );
      }
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'fx_unauthorized' || error.code === 'fx_not_found')) {
        return result
          .addError('apiToken', 'FX rejected this token for that project.')
          .addToast('danger', 'FX rejected the token or project ID.');
      }
      throw error;
    }

    await storage.settings.put('fx', {...next});
    return result.addToast('success', 'Feature Experimentation settings saved.');
  }

  private async saveCms(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await storage.settings.get<CmsSettings>('cms');
    const next: CmsSettings = {
      clientId: text(formData, 'clientId'),
      clientSecret: text(formData, 'clientSecret') || previous.clientSecret || '',
    };
    if (!next.clientId) return result.addError('clientId', 'Required.');
    if (!next.clientSecret) return result.addError('clientSecret', 'Required.');

    try {
      await new CmsClient({clientId: next.clientId, clientSecret: next.clientSecret}).token();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        return result
          .addError('clientSecret', 'The CMS rejected this client ID / secret.')
          .addToast('danger', 'The CMS rejected the API client credentials.');
      }
      throw error;
    }

    await storage.settings.put('cms', {...next});
    return result.addToast('success', 'CMS API client saved.');
  }

  public async onAuthorizationRequest(
    _section: string,
    _formData: SubmittedFormData,
  ): Promise<LifecycleSettingsResult> {
    return new LifecycleSettingsResult().addToast('danger', 'OAuth is not supported.');
  }

  public async onAuthorizationGrant(_request: AppRequest): Promise<AuthorizationGrantResult> {
    return new AuthorizationGrantResult('').addToast('danger', 'OAuth is not supported.');
  }
}
