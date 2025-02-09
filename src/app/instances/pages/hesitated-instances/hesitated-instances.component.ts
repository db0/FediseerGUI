import {Component} from '@angular/core';
import {FilterSpecialValueAllInstances} from "../../../shared/constants";
import {NormalizedInstanceDetailResponse} from "../../../response/normalized-instance-detail.response";
import {Instance} from "../../../user/instance";
import {InstanceDetailResponse} from "../../../response/instance-detail.response";
import {FormControl, FormGroup} from "@angular/forms";
import {environment} from "../../../../environments/environment";
import {TitleService} from "../../../services/title.service";
import {ApiResponse, FediseerApiService} from "../../../services/fediseer-api.service";
import {MessageService} from "../../../services/message.service";
import {ActivatedRoute, Router} from "@angular/router";
import {AuthenticationManagerService} from "../../../services/authentication-manager.service";
import {ApiResponseHelperService} from "../../../services/api-response-helper.service";
import {DatabaseService} from "../../../services/database.service";
import {toPromise} from "../../../types/resolvable";
import {debounceTime} from "rxjs";
import {SuccessResponse} from "../../../response/success.response";
import {CachedFediseerApiService} from "../../../services/cached-fediseer-api.service";

@Component({
  selector: 'app-hesitated-instances',
  templateUrl: './hesitated-instances.component.html',
  styleUrls: ['./hesitated-instances.component.scss']
})
export class HesitatedInstancesComponent {
  private readonly perPage = 30;

  public readonly filterInstanceSpecialValueAll = FilterSpecialValueAllInstances;

  private allInstances: NormalizedInstanceDetailResponse[] = [];

  public instances: NormalizedInstanceDetailResponse[] = [];
  public currentInstance: Instance = this.authManager.currentInstanceSnapshot;
  public hesitatedByMe: string[] = [];
  public maxPage = 1;
  public currentPage = 1;
  public pages: number[] = [];
  public loading: boolean = true;
  public allWhitelistedInstances: InstanceDetailResponse[] = [];

  public filterForm = new FormGroup({
    instances: new FormControl<string[]>(environment.defaultCensuresListInstanceFilter),
    includeEndorsed: new FormControl<boolean>(false),
    includeGuaranteed: new FormControl<boolean>(false),
    recursive: new FormControl<boolean>(true),
    onlyMatching: new FormControl<boolean>(false),
    matchingReasons: new FormControl<string[]>([]),
  });

  constructor(
    private readonly titleService: TitleService,
    private readonly api: FediseerApiService,
    private readonly cachedApi: CachedFediseerApiService,
    private readonly messageService: MessageService,
    private readonly activatedRoute: ActivatedRoute,
    private readonly authManager: AuthenticationManagerService,
    private readonly router: Router,
    private readonly apiResponseHelper: ApiResponseHelperService,
    private readonly database: DatabaseService,
  ) {
  }

  public async ngOnInit(): Promise<void> {
    this.titleService.title = 'Hesitated instances';

    if (!this.currentInstance.anonymous) {
      const response = await toPromise(this.cachedApi.getHesitationsByInstances([this.currentInstance.name]));
      if (this.apiResponseHelper.handleErrors([response])) {
        this.loading = false;
        return;
      }
      this.hesitatedByMe = response.successResponse!.instances.map(instance => instance.domain);
    }

    const allWhitelistedInstancesResponse = await toPromise(this.cachedApi.getWhitelistedInstances());
    if (this.apiResponseHelper.handleErrors([allWhitelistedInstancesResponse])) {
      this.loading = false;
      return;
    }
    this.allWhitelistedInstances = allWhitelistedInstancesResponse.successResponse!.instances;

    const storedFilters = this.database.censureListFilters;
    if (!storedFilters.instances.length) {
      storedFilters.instances = environment.defaultCensuresListInstanceFilter;
    }

    this.filterForm.valueChanges.pipe(
      debounceTime(500),
    ).subscribe(values => {
      this.database.censureListFilters = {
        instances: values.instances ?? environment.defaultCensuresListInstanceFilter,
        includeEndorsed: values.includeEndorsed ?? false,
        includeGuaranteed: values.includeGuaranteed ?? false,
        matchingReasons: values.matchingReasons ?? [],
        onlyMatching: values.onlyMatching ?? false,
        recursive: values.recursive ?? false,
      };
      if (!values.includeGuaranteed && !values.includeEndorsed && !this.filterForm.controls.recursive.disabled) {
        this.filterForm.controls.recursive.disable();
      }
      if ((values.includeGuaranteed || values.includeEndorsed) && this.filterForm.controls.recursive.disabled) {
        this.filterForm.controls.recursive.enable();
      }
    });

    this.filterForm.patchValue({
      instances: storedFilters.instances,
      onlyMatching: storedFilters.onlyMatching,
      matchingReasons: storedFilters.matchingReasons,
      includeGuaranteed: storedFilters.includeGuaranteed,
      includeEndorsed: storedFilters.includeEndorsed,
      recursive: storedFilters.recursive,
    });

    await this.loadInstances(false);

    this.activatedRoute.queryParams.subscribe(query => {
      this.currentPage = query['page'] ? Number(query['page']) : 1;
      this.loadPage();
    });
  }

  public async toggleHesitation(instance: string): Promise<void> {
    const hesitated: boolean = this.hesitatedByMe.indexOf(instance) > -1;
    if (hesitated) {
      this.loading = true;
      const response: ApiResponse<SuccessResponse> = await toPromise(this.api.cancelHesitation(instance));
      if (!response.success) {
        this.messageService.createError(`There was an api error: ${response.errorResponse!.message}`);
        return;
      }
      this.cachedApi.getHesitationsByInstances([this.authManager.currentInstanceSnapshot.name], {clear: true}).subscribe();
    } else {
      await this.router.navigateByUrl(`/hesitations/hesitate?instance=${instance}`);
      return;
    }

    if (hesitated) {
      this.hesitatedByMe = this.hesitatedByMe.filter(endorsedInstance => endorsedInstance !== instance);
      this.loading = false;
    }
  }

  public async goToPage(page: number): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {page: page},
      queryParamsHandling: 'merge',
    });
  }

  public async loadInstances(redirect: boolean = true): Promise<void> {
    this.loading = true;

    let sourceInstances = this.filterForm.controls.instances.value ?? environment.defaultCensuresListInstanceFilter;
    if (!sourceInstances.length) {
      sourceInstances = environment.defaultCensuresListInstanceFilter;
    }
    if (sourceInstances.indexOf(this.filterInstanceSpecialValueAll) > -1) {
      sourceInstances = this.allWhitelistedInstances.map(instance => instance.domain);
    } else {
      const allInstancesString = this.allWhitelistedInstances.map(instance => instance.domain);
      sourceInstances = sourceInstances.filter(instance => allInstancesString.indexOf(instance) > -1);
      if (this.filterForm.controls.includeEndorsed.value) {
        const endorsedResponse = await toPromise(this.cachedApi.getEndorsementsByInstances(sourceInstances));
        if (this.apiResponseHelper.handleErrors([endorsedResponse])) {
          this.loading = false;
          return;
        }
        sourceInstances = [...new Set([
          ...sourceInstances,
          ...endorsedResponse.successResponse!.instances.map(instance => instance.domain)
        ])];
      }
      if (this.filterForm.controls.includeGuaranteed.value) {
        const guaranteed = await Promise.all(sourceInstances.map(async sourceInstance => {
          const guaranteedResponse = await toPromise(this.cachedApi.getGuaranteesByInstance(sourceInstance));
          if (this.apiResponseHelper.handleErrors([guaranteedResponse])) {
            this.loading = false;
            return [sourceInstance];
          }
          return [
            sourceInstance,
            ...guaranteedResponse.successResponse!.instances.map(instance => instance.domain),
          ];
        }));

        sourceInstances = [...new Set([
          ...sourceInstances,
          ...(<string[]>guaranteed.flat(Infinity)),
        ])];
      }
    }

    const response = await toPromise(this.cachedApi.getHesitationsByInstances(sourceInstances));
    if (this.apiResponseHelper.handleErrors([response])) {
      this.loading = false;
      return;
    }
    this.allInstances = response.successResponse!.instances.map(instance => NormalizedInstanceDetailResponse.fromInstanceDetail(instance))
      .sort((a, b) => {
        const countA = a.unmergedHesitationReasons.length;
        const countB = b.unmergedHesitationReasons.length;

        if (countA === countB) {
          return 0;
        }

        return countA > countB ? -1 : 1;
      });
    this.titleService.title = `Hesitated instances (${this.allInstances.length})`;
    this.maxPage = Math.ceil(this.allInstances.length / this.perPage);
    this.pages = [];
    for (let i = 1; i <= this.maxPage; ++i) {
      this.pages.push(i);
    }
    if (redirect) {
      await this.router.navigate([], {
        relativeTo: this.activatedRoute,
        queryParams: {page: 1},
        queryParamsHandling: 'merge',
      });
    }
    await this.loadPage();
    this.loading = false;
  }

  private async loadPage(): Promise<void> {
    this.instances = this.allInstances.slice((this.currentPage - 1) * this.perPage, this.currentPage * this.perPage);
  }
}
