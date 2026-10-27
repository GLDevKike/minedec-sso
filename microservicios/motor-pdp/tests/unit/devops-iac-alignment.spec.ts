import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Alineación Multirrepositorio GitLab CI/CD e Infraestructura IaC (T063 / T094 / T053 / T063)', () => {
  const serviceRoot = path.resolve(__dirname, '../..');
  const microserviciosRoot = path.resolve(serviceRoot, '..');
  const iacRoot = path.resolve(microserviciosRoot, '../iac-terraform');

  it('valida que los 6 repositorios en microservicios/ poseen .gitlab-ci.yml y .npmrc para GitLab NPM Registry', () => {
    const repos = [
      'shared',
      'pip-identity-service',
      'sincronizador',
      'conciliacion-job',
      'sso-oidc',
      'motor-pdp',
    ];

    for (const repo of repos) {
      const repoDir = path.join(microserviciosRoot, repo);
      const gitlabCiPath = path.join(repoDir, '.gitlab-ci.yml');
      const npmrcPath = path.join(repoDir, '.npmrc');

      expect(fs.existsSync(gitlabCiPath)).toBe(true);
      expect(fs.existsSync(npmrcPath)).toBe(true);

      const gitlabCi = fs.readFileSync(gitlabCiPath, 'utf8');
      const npmrc = fs.readFileSync(npmrcPath, 'utf8');

      expect(gitlabCi).toContain('gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com');
      expect(npmrc).toContain('@minedec:registry=');

      if (repo !== 'shared') {
        const dockerfilePath = path.join(repoDir, 'Dockerfile');
        expect(fs.existsSync(dockerfilePath)).toBe(true);
        const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
        expect(dockerfile).toContain('FROM node:22-alpine');
        expect(dockerfile).toMatch(/USER (node|appuser)/);
        expect(gitlabCi).toContain('sso-containers');
      } else {
        expect(gitlabCi).toContain('npm publish');
      }
    }
  });

  it('valida la estructura de 3 capas en iac-terraform sin stack host y con scripts/bundle.sh y .gitlab-ci.yml', () => {
    expect(fs.existsSync(path.join(iacRoot, 'modulos'))).toBe(true);
    expect(fs.existsSync(path.join(iacRoot, 'plantillas', 'devops'))).toBe(true);
    expect(fs.existsSync(path.join(iacRoot, 'plantillas', 'data'))).toBe(true);
    expect(fs.existsSync(path.join(iacRoot, 'plantillas', 'apps'))).toBe(true);
    expect(fs.existsSync(path.join(iacRoot, 'plantillas', 'host'))).toBe(false);

    const bundleSh = fs.readFileSync(path.join(iacRoot, 'scripts', 'bundle.sh'), 'utf8');
    expect(bundleSh).toContain('cp -r "$RAIZ/plantillas" "$DESTINO/plantillas"');
    expect(bundleSh).toContain('cp -r "$RAIZ/modulos" "$DESTINO/modulos"');

    const gitlabCi = fs.readFileSync(path.join(iacRoot, '.gitlab-ci.yml'), 'utf8');
    expect(gitlabCi).toContain('sa-infra-manager@mec-003-sso-des.iam.gserviceaccount.com');
    expect(gitlabCi).toContain('gitlab-runner@gitlab-servinformacion.iam.gserviceaccount.com');
    expect(gitlabCi).toContain('--gcs-source="${FUENTE}"');
    expect(gitlabCi).toContain('--tf-version-constraint="=${TF_VERSION}"');
  });

  it('valida nomenclatura sso-*, Shared VPC y recursos en despliegues/{des,pre,pro}/{devops,data,apps}', () => {
    const envs: Array<{ env: string; projectId: string; hostProjectId: string }> = [
      { env: 'des', projectId: 'mec-003-sso-des', hostProjectId: 'mec-003-sha-net-des' },
      { env: 'pre', projectId: 'mec-003-sso-pre', hostProjectId: 'mec-003-sha-net-pre' },
      { env: 'pro', projectId: 'mec-003-sso-pro', hostProjectId: 'mec-003-sha-net-pro-511014' },
    ];

    for (const { env, projectId, hostProjectId } of envs) {
      const devopsTfvars = fs.readFileSync(
        path.join(iacRoot, 'despliegues', env, 'devops', 'terraform.tfvars'),
        'utf8',
      );
      expect(devopsTfvars).toContain(`project_id = "${projectId}"`);
      expect(devopsTfvars).toContain(`host_project_id = "${hostProjectId}"`);
      expect(devopsTfvars).toContain('"sa-sso-core"');
      expect(devopsTfvars).toContain('"sa-sso-sync"');
      expect(devopsTfvars).toContain('"sa-sso-sync-job"');
      expect(devopsTfvars).toContain('"sa-sso-publicador"');
      expect(devopsTfvars).toContain('"sa-workspace-reader"');
      expect(devopsTfvars).not.toContain('sa-conecta');

      const dataTfvars = fs.readFileSync(
        path.join(iacRoot, 'despliegues', env, 'data', 'terraform.tfvars'),
        'utf8',
      );
      expect(dataTfvars).toContain(`project_id = "${projectId}"`);
      expect(dataTfvars).toContain(`host_project_id       = "${hostProjectId}"`);
      expect(dataTfvars).toContain(`"sso-alloydb-${env}"`);
      expect(dataTfvars).toContain(`"sso-redis-${env}"`);
      expect(dataTfvars).toContain('"sso-revocaciones"');
      expect(dataTfvars).toContain('"sso-pip-cache-invalidation"');
      expect(dataTfvars).toContain('is_locked        = true');
      expect(dataTfvars).toContain('deletion_protection        = true');

      const appsTfvars = fs.readFileSync(
        path.join(iacRoot, 'despliegues', env, 'apps', 'terraform.tfvars'),
        'utf8',
      );
      expect(appsTfvars).toContain(`project_id = "${projectId}"`);
      expect(appsTfvars).toContain(`host_project_id   = "${hostProjectId}"`);
      expect(appsTfvars).toContain(`cluster_name = "sso-gke-${env}-ue1"`);
      expect(appsTfvars).toContain('waf_policy_name        = "sso-oidc-waf-policy"');
    }

    const appsPlantillaMain = fs.readFileSync(
      path.join(iacRoot, 'plantillas', 'apps', 'main.tf'),
      'utf8',
    );
    expect(appsPlantillaMain).toContain('google_compute_security_policy');
    expect(appsPlantillaMain).toContain("evaluatePreconfiguredWaf('sqli-v33-stable')");
    expect(appsPlantillaMain).toContain("evaluatePreconfiguredWaf('xss-v33-stable')");
    expect(appsPlantillaMain).toContain("evaluatePreconfiguredWaf('protocolattack-v33-stable')");
    expect(appsPlantillaMain).toContain("evaluatePreconfiguredWaf('sessionfixation-v33-stable')");
  });
});
