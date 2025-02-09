import {Component, OnInit} from '@angular/core';
import {TitleService} from "../../../services/title.service";
import {FormControl, FormGroup, Validators} from "@angular/forms";
import {MessageService} from "../../../services/message.service";
import {FediseerApiService} from "../../../services/fediseer-api.service";
import {Router} from "@angular/router";
import {CachedFediseerApiService} from "../../../services/cached-fediseer-api.service";
import {AuthenticationManagerService} from "../../../services/authentication-manager.service";
import {forkJoin} from "rxjs";

@Component({
  selector: 'app-guarantee-instance',
  templateUrl: './guarantee-instance.component.html',
  styleUrls: ['./guarantee-instance.component.scss']
})
export class GuaranteeInstanceComponent implements OnInit {
  public form = new FormGroup({
    instance: new FormControl<string>('', [Validators.required]),
  });
  public loading: boolean = false;

  constructor(
    private readonly titleService: TitleService,
    private readonly messageService: MessageService,
    private readonly api: FediseerApiService,
    private readonly cachedApi: CachedFediseerApiService,
    private readonly router: Router,
    private readonly authManager: AuthenticationManagerService,
  ) {
  }

  public async ngOnInit(): Promise<void> {
    this.titleService.title = 'Guarantee an instance';
  }

  public async doGuarantee(): Promise<void> {
    if (!this.form.valid) {
      this.messageService.createError("The form is not valid, please make sure all fields are filled correctly.");
      return;
    }

    this.loading = true;
    this.api.guaranteeInstance(this.form.controls.instance.value!).subscribe(response => {
      this.loading = false;
      if (!response.success) {
        this.loading = false;
        this.messageService.createError(`There was an api error: ${response.errorResponse!.message}`);
        return;
      }

      const currentInstance = this.authManager.currentInstanceSnapshot.name;
      forkJoin([
        this.cachedApi.getGuaranteesByInstance(currentInstance, {clear: true}),
        this.cachedApi.getCensuresByInstances([currentInstance], {clear: true}),
        this.cachedApi.getHesitationsByInstances([currentInstance], {clear: true}),
        this.cachedApi.getWhitelistedInstances({clear: true}),
      ]).subscribe(() => {
        this.loading = false;
        this.router.navigateByUrl('/guarantees/my').then(() => {
          this.messageService.createSuccess(`${this.form.controls.instance.value} was successfully guaranteed!`);
          this.cachedApi.getWhitelistedInstances({clear: true}).subscribe();
        });
      });
    });
  }
}
