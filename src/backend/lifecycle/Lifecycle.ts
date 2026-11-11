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
import {fetchDatafile, isSdkKey} from '../lib/datafile';
import {FxClient} from '../lib/fx';
import {ApiError} from '../lib/http';
import {CmsSettings, FxSettings, readSection, toFxConfig} from '../lib/settings';

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
    const previous = await readSection<FxSettings>('fx');
    const apiToken = text(formData, 'apiToken') || previous.apiToken || '';
    const sdkKey = text(formData, 'sdkKey');
    if (!apiToken) return result.addError('apiToken', 'Required.');
    if (!isSdkKey(sdkKey)) return result.addError('sdkKey', 'Paste the SDK key your site uses.');

    // The SDK key decides which project and environment the site reads, so take both
    // from its datafile rather than asking for them.
    let projectId: string;
    let environmentKey: string;
    try {
      const datafile = await fetchDatafile(sdkKey, {fresh: true});
      projectId = String(datafile.projectId);
      environmentKey = datafile.environmentKey;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        return result.addError('sdkKey', 'No datafile for this SDK key. Check it in FX → Settings → Environments.');
      }
      throw error;
    }

    const next: FxSettings = {apiToken, sdkKey, projectId, environmentKey};
    try {
      const environments = await new FxClient(toFxConfig(next)).listEnvironments();
      if (!environments.includes(environmentKey)) {
        return result.addError('apiToken', `This token can't see environment "${environmentKey}" of project ${projectId}.`);
      }
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'fx_unauthorized' || error.code === 'fx_not_found')) {
        return result
          .addError('apiToken', `FX rejected this token for project ${projectId}.`)
          .addToast('danger', 'FX rejected the token for the SDK key\'s project.');
      }
      throw error;
    }

    await storage.settings.put('fx', {...next});
    return result.addToast('success', `Saved. Experiments go to project ${projectId}, environment ${environmentKey}.`);
  }

  private async saveCms(formData: SubmittedFormData, result: LifecycleSettingsResult) {
    const previous = await readSection<CmsSettings>('cms');
    const next: CmsSettings = {
      clientId: text(formData, 'clientId'),
      clientSecret: text(formData, 'clientSecret') || previous.clientSecret || '',
      allowDelete: formData.allowDelete === true || formData.allowDelete === 'true',
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
    logger.info('CMS settings saved', {allowDelete: next.allowDelete});
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
