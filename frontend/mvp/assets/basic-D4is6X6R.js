import{d as I,G as q,A as P,U as N,t as _,o as R,a as ft,e as c,p as D,R as E,j as L,Y as At,a0 as wn,X as re,T as mn,C as ee,r as H,k as ge,Z as De,n as Ie,M as Ut,a1 as zt,a2 as Ft,a3 as bn,D as Vt,w as je,a4 as yn,a5 as Cn,h as Wt,i as qt,a6 as pt}from"./core-DgOMHBGZ.js";import{n as h,r as v,c as T,o as W,U as te,i as vn,t as $n,b as xn,a as En}from"./index-bo-lexK1.js";import{e as Rn}from"./index-Cn5aGd7v.js";import{dm as Sn}from"./index-DNfT9nEc.js";var xe=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let ce=class extends I{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=q.state.connectors,this.count=P.state.count,this.filteredCount=P.state.filteredWallets.length,this.isFetchingRecommendedWallets=P.state.isFetchingRecommendedWallets,this.unsubscribe.push(q.subscribeKey("connectors",e=>this.connectors=e),P.subscribeKey("count",e=>this.count=e),P.subscribeKey("filteredWallets",e=>this.filteredCount=e.length),P.subscribeKey("isFetchingRecommendedWallets",e=>this.isFetchingRecommendedWallets=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){const e=this.connectors.find(u=>u.id==="walletConnect"),{allWallets:n}=N.state;if(!e||n==="HIDE"||n==="ONLY_MOBILE"&&!_.isMobile())return null;const o=P.state.featured.length,r=this.count+o,i=r<10?r:Math.floor(r/10)*10,s=this.filteredCount>0?this.filteredCount:i;let a=`${s}`;this.filteredCount>0?a=`${this.filteredCount}`:s<r&&(a=`${s}+`);const l=R.hasAnyConnection(ft.CONNECTOR_ID.WALLET_CONNECT);return c`
      <wui-list-wallet
        name="Search Wallet"
        walletIcon="search"
        showAllWallets
        @click=${this.onAllWallets.bind(this)}
        tagLabel=${a}
        tagVariant="info"
        data-testid="all-wallets"
        tabIdx=${W(this.tabIdx)}
        .loading=${this.isFetchingRecommendedWallets}
        ?disabled=${l}
        size="sm"
      ></wui-list-wallet>
    `}onAllWallets(){var e;D.sendEvent({type:"track",event:"CLICK_ALL_WALLETS"}),E.push("AllWallets",{redirectView:(e=E.state.data)==null?void 0:e.redirectView})}};xe([h()],ce.prototype,"tabIdx",void 0);xe([v()],ce.prototype,"connectors",void 0);xe([v()],ce.prototype,"count",void 0);xe([v()],ce.prototype,"filteredCount",void 0);xe([v()],ce.prototype,"isFetchingRecommendedWallets",void 0);ce=xe([T("w3m-all-wallets-widget")],ce);const Tn=L`
  :host {
    margin-top: ${({spacing:t})=>t[1]};
  }
  wui-separator {
    margin: ${({spacing:t})=>t[3]} calc(${({spacing:t})=>t[3]} * -1)
      ${({spacing:t})=>t[2]} calc(${({spacing:t})=>t[3]} * -1);
    width: calc(100% + ${({spacing:t})=>t[3]} * 2);
  }
`;var Ee=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let se=class extends I{constructor(){super(),this.unsubscribe=[],this.explorerWallets=P.state.explorerWallets,this.connections=R.state.connections,this.connectorImages=At.state.connectorImages,this.loadingTelegram=!1,this.unsubscribe.push(R.subscribeKey("connections",e=>this.connections=e),At.subscribeKey("connectorImages",e=>this.connectorImages=e),P.subscribeKey("explorerFilteredWallets",e=>{this.explorerWallets=e!=null&&e.length?e:P.state.explorerWallets}),P.subscribeKey("explorerWallets",e=>{var n;(n=this.explorerWallets)!=null&&n.length||(this.explorerWallets=e)})),_.isTelegram()&&_.isIos()&&(this.loadingTelegram=!R.state.wcUri,this.unsubscribe.push(R.subscribeKey("wcUri",e=>this.loadingTelegram=!e)))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return c`
      <wui-flex flexDirection="column" gap="2"> ${this.connectorListTemplate()} </wui-flex>
    `}connectorListTemplate(){return wn.connectorList().map((e,n)=>e.kind==="connector"?this.renderConnector(e,n):this.renderWallet(e,n))}getConnectorNamespaces(e){var n;return e.subtype==="walletConnect"?[]:e.subtype==="multiChain"?((n=e.connector.connectors)==null?void 0:n.map(o=>o.chain))||[]:[e.connector.chain]}renderConnector(e,n){var S,y;const o=e.connector,r=re.getConnectorImage(o)||this.connectorImages[(o==null?void 0:o.imageId)??""],s=(this.connections.get(o.chain)??[]).some(b=>mn.isLowerCaseMatch(b.connectorId,o.id));let a,l;e.subtype==="walletConnect"?(a="qr code",l="accent"):e.subtype==="injected"||e.subtype==="announced"?(a=s?"connected":"installed",l=s?"info":"success"):(a=void 0,l=void 0);const u=R.hasAnyConnection(ft.CONNECTOR_ID.WALLET_CONNECT),w=e.subtype==="walletConnect"||e.subtype==="external"?u:!1;return c`
      <w3m-list-wallet
        displayIndex=${n}
        imageSrc=${W(r)}
        .installed=${!0}
        name=${o.name??"Unknown"}
        .tagVariant=${l}
        tagLabel=${W(a)}
        data-testid=${`wallet-selector-${o.id.toLowerCase()}`}
        size="sm"
        @click=${()=>this.onClickConnector(e)}
        tabIdx=${W(this.tabIdx)}
        ?disabled=${w}
        rdnsId=${W(((S=o.explorerWallet)==null?void 0:S.rdns)||void 0)}
        walletRank=${W((y=o.explorerWallet)==null?void 0:y.order)}
        .namespaces=${this.getConnectorNamespaces(e)}
      >
      </w3m-list-wallet>
    `}onClickConnector(e){var o;const n=(o=E.state.data)==null?void 0:o.redirectView;if(e.subtype==="walletConnect"){q.setActiveConnector(e.connector),_.isMobile()?E.push("AllWallets"):E.push("ConnectingWalletConnect",{redirectView:n});return}if(e.subtype==="multiChain"){q.setActiveConnector(e.connector),E.push("ConnectingMultiChain",{redirectView:n});return}if(e.subtype==="injected"){q.setActiveConnector(e.connector),E.push("ConnectingExternal",{connector:e.connector,redirectView:n,wallet:e.connector.explorerWallet});return}if(e.subtype==="announced"){if(e.connector.id==="walletConnect"){_.isMobile()?E.push("AllWallets"):E.push("ConnectingWalletConnect",{redirectView:n});return}E.push("ConnectingExternal",{connector:e.connector,redirectView:n,wallet:e.connector.explorerWallet});return}E.push("ConnectingExternal",{connector:e.connector,redirectView:n})}renderWallet(e,n){const o=e.wallet,r=re.getWalletImage(o),s=R.hasAnyConnection(ft.CONNECTOR_ID.WALLET_CONNECT),a=this.loadingTelegram,l=e.subtype==="recent"?"recent":void 0,u=e.subtype==="recent"?"info":void 0;return c`
      <w3m-list-wallet
        displayIndex=${n}
        imageSrc=${W(r)}
        name=${o.name??"Unknown"}
        @click=${()=>this.onClickWallet(e)}
        size="sm"
        data-testid=${`wallet-selector-${o.id}`}
        tabIdx=${W(this.tabIdx)}
        ?loading=${a}
        ?disabled=${s}
        rdnsId=${W(o.rdns||void 0)}
        walletRank=${W(o.order)}
        tagLabel=${W(l)}
        .tagVariant=${u}
      >
      </w3m-list-wallet>
    `}onClickWallet(e){var i;const n=(i=E.state.data)==null?void 0:i.redirectView,o=ee.state.activeChain;if(e.subtype==="featured"){q.selectWalletConnector(e.wallet);return}if(e.subtype==="recent"){if(this.loadingTelegram)return;q.selectWalletConnector(e.wallet);return}if(e.subtype==="custom"){if(this.loadingTelegram)return;E.push("ConnectingWalletConnect",{wallet:e.wallet,redirectView:n});return}if(this.loadingTelegram)return;const r=o?q.getConnector({id:e.wallet.id,namespace:o}):void 0;r?E.push("ConnectingExternal",{connector:r,redirectView:n}):E.push("ConnectingWalletConnect",{wallet:e.wallet,redirectView:n})}};se.styles=Tn;Ee([h({type:Number})],se.prototype,"tabIdx",void 0);Ee([v()],se.prototype,"explorerWallets",void 0);Ee([v()],se.prototype,"connections",void 0);Ee([v()],se.prototype,"connectorImages",void 0);Ee([v()],se.prototype,"loadingTelegram",void 0);se=Ee([T("w3m-connector-list")],se);const _n=L`
  :host {
    flex: 1;
    height: 100%;
  }

  button {
    width: 100%;
    height: 100%;
    display: inline-flex;
    align-items: center;
    padding: ${({spacing:t})=>t[1]} ${({spacing:t})=>t[2]};
    column-gap: ${({spacing:t})=>t[1]};
    color: ${({tokens:t})=>t.theme.textSecondary};
    border-radius: ${({borderRadius:t})=>t[20]};
    background-color: transparent;
    transition: background-color ${({durations:t})=>t.lg}
      ${({easings:t})=>t["ease-out-power-2"]};
    will-change: background-color;
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  button[data-active='true'] {
    color: ${({tokens:t})=>t.theme.textPrimary};
    background-color: ${({tokens:t})=>t.theme.foregroundTertiary};
  }

  button:hover:enabled:not([data-active='true']),
  button:active:enabled:not([data-active='true']) {
    wui-text,
    wui-icon {
      color: ${({tokens:t})=>t.theme.textPrimary};
    }
  }
`;var We=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};const In={lg:"lg-regular",md:"md-regular",sm:"sm-regular"},An={lg:"md",md:"sm",sm:"sm"};let ue=class extends I{constructor(){super(...arguments),this.icon="mobile",this.size="md",this.label="",this.active=!1}render(){return c`
      <button data-active=${this.active}>
        ${this.icon?c`<wui-icon size=${An[this.size]} name=${this.icon}></wui-icon>`:""}
        <wui-text variant=${In[this.size]}> ${this.label} </wui-text>
      </button>
    `}};ue.styles=[H,ge,_n];We([h()],ue.prototype,"icon",void 0);We([h()],ue.prototype,"size",void 0);We([h()],ue.prototype,"label",void 0);We([h({type:Boolean})],ue.prototype,"active",void 0);ue=We([T("wui-tab-item")],ue);const Wn=L`
  :host {
    display: inline-flex;
    align-items: center;
    background-color: ${({tokens:t})=>t.theme.foregroundSecondary};
    border-radius: ${({borderRadius:t})=>t[32]};
    padding: ${({spacing:t})=>t["01"]};
    box-sizing: border-box;
  }

  :host([data-size='sm']) {
    height: 26px;
  }

  :host([data-size='md']) {
    height: 36px;
  }
`;var Pe=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let de=class extends I{constructor(){super(...arguments),this.tabs=[],this.onTabChange=()=>null,this.size="md",this.activeTab=0}render(){return this.dataset.size=this.size,this.tabs.map((e,n)=>{var r;const o=n===this.activeTab;return c`
        <wui-tab-item
          @click=${()=>this.onTabClick(n)}
          icon=${e.icon}
          size=${this.size}
          label=${e.label}
          ?active=${o}
          data-active=${o}
          data-testid="tab-${(r=e.label)==null?void 0:r.toLowerCase()}"
        ></wui-tab-item>
      `})}onTabClick(e){this.activeTab=e,this.onTabChange(e)}};de.styles=[H,ge,Wn];Pe([h({type:Array})],de.prototype,"tabs",void 0);Pe([h()],de.prototype,"onTabChange",void 0);Pe([h()],de.prototype,"size",void 0);Pe([v()],de.prototype,"activeTab",void 0);de=Pe([T("wui-tabs")],de);var Ct=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Ue=class extends I{constructor(){super(...arguments),this.platformTabs=[],this.unsubscribe=[],this.platforms=[],this.onSelectPlatfrom=void 0}disconnectCallback(){this.unsubscribe.forEach(e=>e())}render(){const e=this.generateTabs();return c`
      <wui-flex justifyContent="center" .padding=${["0","0","4","0"]}>
        <wui-tabs .tabs=${e} .onTabChange=${this.onTabChange.bind(this)}></wui-tabs>
      </wui-flex>
    `}generateTabs(){const e=this.platforms.map(n=>n==="browser"?{label:"Browser",icon:"extension",platform:"browser"}:n==="mobile"?{label:"Mobile",icon:"mobile",platform:"mobile"}:n==="qrcode"?{label:"Mobile",icon:"mobile",platform:"qrcode"}:n==="web"?{label:"Webapp",icon:"browser",platform:"web"}:n==="desktop"?{label:"Desktop",icon:"desktop",platform:"desktop"}:{label:"Browser",icon:"extension",platform:"unsupported"});return this.platformTabs=e.map(({platform:n})=>n),e}onTabChange(e){var o;const n=this.platformTabs[e];n&&((o=this.onSelectPlatfrom)==null||o.call(this,n))}};Ct([h({type:Array})],Ue.prototype,"platforms",void 0);Ct([h()],Ue.prototype,"onSelectPlatfrom",void 0);Ue=Ct([T("w3m-connecting-header")],Ue);const Pn=L`
  :host {
    display: block;
    width: 100px;
    height: 100px;
  }

  svg {
    width: 100px;
    height: 100px;
  }

  rect {
    fill: none;
    stroke: ${t=>t.colors.accent100};
    stroke-width: 3px;
    stroke-linecap: round;
    animation: dash 1s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: 0px;
    }
  }
`;var Ht=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let ze=class extends I{constructor(){super(...arguments),this.radius=36}render(){return this.svgLoaderTemplate()}svgLoaderTemplate(){const e=this.radius>50?50:this.radius,o=36-e,r=116+o,i=245+o,s=360+o*1.75;return c`
      <svg viewBox="0 0 110 110" width="110" height="110">
        <rect
          x="2"
          y="2"
          width="106"
          height="106"
          rx=${e}
          stroke-dasharray="${r} ${i}"
          stroke-dashoffset=${s}
        />
      </svg>
    `}};ze.styles=[H,Pn];Ht([h({type:Number})],ze.prototype,"radius",void 0);ze=Ht([T("wui-loading-thumbnail")],ze);const Bn=L`
  wui-flex {
    width: 100%;
    height: 52px;
    box-sizing: border-box;
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
    border-radius: ${({borderRadius:t})=>t[5]};
    padding-left: ${({spacing:t})=>t[3]};
    padding-right: ${({spacing:t})=>t[3]};
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${({spacing:t})=>t[6]};
  }

  wui-text {
    color: ${({tokens:t})=>t.theme.textSecondary};
  }

  wui-icon {
    width: 12px;
    height: 12px;
  }
`;var Ze=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let me=class extends I{constructor(){super(...arguments),this.disabled=!1,this.label="",this.buttonLabel=""}render(){return c`
      <wui-flex justifyContent="space-between" alignItems="center">
        <wui-text variant="lg-regular" color="inherit">${this.label}</wui-text>
        <wui-button variant="accent-secondary" size="sm">
          ${this.buttonLabel}
          <wui-icon name="chevronRight" color="inherit" size="inherit" slot="iconRight"></wui-icon>
        </wui-button>
      </wui-flex>
    `}};me.styles=[H,ge,Bn];Ze([h({type:Boolean})],me.prototype,"disabled",void 0);Ze([h()],me.prototype,"label",void 0);Ze([h()],me.prototype,"buttonLabel",void 0);me=Ze([T("wui-cta-button")],me);const Ln=L`
  :host {
    display: block;
    padding: 0 ${({spacing:t})=>t[5]} ${({spacing:t})=>t[5]};
  }
`;var Kt=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Fe=class extends I{constructor(){super(...arguments),this.wallet=void 0}render(){if(!this.wallet)return this.style.display="none",null;const{name:e,app_store:n,play_store:o,chrome_store:r,homepage:i}=this.wallet,s=_.isMobile(),a=_.isIos(),l=_.isAndroid(),u=[n,o,i,r].filter(Boolean).length>1,w=te.getTruncateString({string:e,charsStart:12,charsEnd:0,truncate:"end"});return u&&!s?c`
        <wui-cta-button
          label=${`Don't have ${w}?`}
          buttonLabel="Get"
          @click=${()=>E.push("Downloads",{wallet:this.wallet})}
        ></wui-cta-button>
      `:!u&&i?c`
        <wui-cta-button
          label=${`Don't have ${w}?`}
          buttonLabel="Get"
          @click=${this.onHomePage.bind(this)}
        ></wui-cta-button>
      `:n&&a?c`
        <wui-cta-button
          label=${`Don't have ${w}?`}
          buttonLabel="Get"
          @click=${this.onAppStore.bind(this)}
        ></wui-cta-button>
      `:o&&l?c`
        <wui-cta-button
          label=${`Don't have ${w}?`}
          buttonLabel="Get"
          @click=${this.onPlayStore.bind(this)}
        ></wui-cta-button>
      `:(this.style.display="none",null)}onAppStore(){var e;(e=this.wallet)!=null&&e.app_store&&_.openHref(this.wallet.app_store,"_blank")}onPlayStore(){var e;(e=this.wallet)!=null&&e.play_store&&_.openHref(this.wallet.play_store,"_blank")}onHomePage(){var e;(e=this.wallet)!=null&&e.homepage&&_.openHref(this.wallet.homepage,"_blank")}};Fe.styles=[Ln];Kt([h({type:Object})],Fe.prototype,"wallet",void 0);Fe=Kt([T("w3m-mobile-download-links")],Fe);const kn=L`
  @keyframes shake {
    0% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(3px);
    }
    50% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
    100% {
      transform: translateX(0);
    }
  }

  wui-flex:first-child:not(:only-child) {
    position: relative;
  }

  wui-wallet-image {
    width: 56px;
    height: 56px;
  }

  wui-loading-thumbnail {
    position: absolute;
  }

  wui-icon-box {
    position: absolute;
    right: calc(${({spacing:t})=>t[1]} * -1);
    bottom: calc(${({spacing:t})=>t[1]} * -1);
    opacity: 0;
    transform: scale(0.5);
    transition-property: opacity, transform;
    transition-duration: ${({durations:t})=>t.lg};
    transition-timing-function: ${({easings:t})=>t["ease-out-power-2"]};
    will-change: opacity, transform;
  }

  wui-text[align='center'] {
    width: 100%;
    padding: 0px ${({spacing:t})=>t[4]};
  }

  [data-error='true'] wui-icon-box {
    opacity: 1;
    transform: scale(1);
  }

  [data-error='true'] > wui-flex:first-child {
    animation: shake 250ms ${({easings:t})=>t["ease-out-power-2"]} both;
  }

  [data-retry='false'] wui-link {
    display: none;
  }

  [data-retry='true'] wui-link {
    display: block;
    opacity: 1;
  }

  w3m-mobile-download-links {
    padding: 0px;
    width: 100%;
  }
`;var K=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};class k extends I{constructor(){var e,n,o,r,i;super(),this.wallet=(e=E.state.data)==null?void 0:e.wallet,this.connector=(n=E.state.data)==null?void 0:n.connector,this.timeout=void 0,this.secondaryBtnIcon="refresh",this.onConnect=void 0,this.onRender=void 0,this.onAutoConnect=void 0,this.isWalletConnect=!0,this.unsubscribe=[],this.imageSrc=re.getConnectorImage(this.connector)??re.getWalletImage(this.wallet),this.name=((o=this.wallet)==null?void 0:o.name)??((r=this.connector)==null?void 0:r.name)??"Wallet",this.isRetrying=!1,this.uri=R.state.wcUri,this.error=R.state.wcError,this.ready=!1,this.showRetry=!1,this.label=void 0,this.secondaryBtnLabel="Try again",this.secondaryLabel="Accept connection request in the wallet",this.isLoading=!1,this.isMobile=!1,this.onRetry=void 0,this.unsubscribe.push(R.subscribeKey("wcUri",s=>{var a;this.uri=s,this.isRetrying&&this.onRetry&&(this.isRetrying=!1,(a=this.onConnect)==null||a.call(this))}),R.subscribeKey("wcError",s=>this.error=s)),(_.isTelegram()||_.isSafari())&&_.isIos()&&R.state.wcUri&&((i=this.onConnect)==null||i.call(this))}firstUpdated(){var e;(e=this.onAutoConnect)==null||e.call(this),this.showRetry=!this.onAutoConnect}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),R.setWcError(!1),clearTimeout(this.timeout)}render(){var o;(o=this.onRender)==null||o.call(this),this.onShowRetry();const e=this.error?"Connection can be declined if a previous request is still active":this.secondaryLabel;let n="";return this.label?n=this.label:(n=`Continue in ${this.name}`,this.error&&(n="Connection declined")),c`
      <wui-flex
        data-error=${W(this.error)}
        data-retry=${this.showRetry}
        flexDirection="column"
        alignItems="center"
        .padding=${["10","5","5","5"]}
        gap="6"
      >
        <wui-flex gap="2" justifyContent="center" alignItems="center">
          <wui-wallet-image size="lg" imageSrc=${W(this.imageSrc)}></wui-wallet-image>

          ${this.error?null:this.loaderTemplate()}

          <wui-icon-box
            color="error"
            icon="close"
            size="sm"
            border
            borderColor="wui-color-bg-125"
          ></wui-icon-box>
        </wui-flex>

        <wui-flex flexDirection="column" alignItems="center" gap="6"> <wui-flex
          flexDirection="column"
          alignItems="center"
          gap="2"
          .padding=${["2","0","0","0"]}
        >
          <wui-text align="center" variant="lg-medium" color=${this.error?"error":"primary"}>
            ${n}
          </wui-text>
          <wui-text align="center" variant="lg-regular" color="secondary">${e}</wui-text>
        </wui-flex>

        ${this.secondaryBtnLabel?c`
                <wui-button
                  variant="neutral-secondary"
                  size="md"
                  ?disabled=${this.isRetrying||this.isLoading}
                  @click=${this.onTryAgain.bind(this)}
                  data-testid="w3m-connecting-widget-secondary-button"
                >
                  <wui-icon
                    color="inherit"
                    slot="iconLeft"
                    name=${this.secondaryBtnIcon}
                  ></wui-icon>
                  ${this.secondaryBtnLabel}
                </wui-button>
              `:null}
      </wui-flex>

      ${this.isWalletConnect?c`
              <wui-flex .padding=${["0","5","5","5"]} justifyContent="center">
                <wui-link
                  @click=${this.onCopyUri}
                  variant="secondary"
                  icon="copy"
                  data-testid="wui-link-copy"
                >
                  Copy link
                </wui-link>
              </wui-flex>
            `:null}

      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links></wui-flex>
      </wui-flex>
    `}onShowRetry(){var e;if(this.error&&!this.showRetry){this.showRetry=!0;const n=(e=this.shadowRoot)==null?void 0:e.querySelector("wui-button");n==null||n.animate([{opacity:0},{opacity:1}],{fill:"forwards",easing:"ease"})}}onTryAgain(){var e,n;R.setWcError(!1),this.onRetry?(this.isRetrying=!0,(e=this.onRetry)==null||e.call(this)):(n=this.onConnect)==null||n.call(this)}loaderTemplate(){const e=De.state.themeVariables["--w3m-border-radius-master"],n=e?parseInt(e.replace("px",""),10):4;return c`<wui-loading-thumbnail radius=${n*9}></wui-loading-thumbnail>`}onCopyUri(){try{this.uri&&(_.copyToClopboard(this.uri),Ie.showSuccess("Link copied"))}catch{Ie.showError("Failed to copy")}}}k.styles=kn;K([v()],k.prototype,"isRetrying",void 0);K([v()],k.prototype,"uri",void 0);K([v()],k.prototype,"error",void 0);K([v()],k.prototype,"ready",void 0);K([v()],k.prototype,"showRetry",void 0);K([v()],k.prototype,"label",void 0);K([v()],k.prototype,"secondaryBtnLabel",void 0);K([v()],k.prototype,"secondaryLabel",void 0);K([v()],k.prototype,"isLoading",void 0);K([h({type:Boolean})],k.prototype,"isMobile",void 0);K([h()],k.prototype,"onRetry",void 0);var Nn=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Pt=class extends k{constructor(){var e;if(super(),!this.wallet)throw new Error("w3m-connecting-wc-browser: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.onAutoConnect=this.onConnectProxy.bind(this),D.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"browser",displayIndex:(e=this.wallet)==null?void 0:e.display_index,walletRank:this.wallet.order,view:E.state.view}})}async onConnectProxy(){try{this.error=!1;const{connectors:e}=q.state,n=e.find(o=>{var r,i,s;return o.type==="ANNOUNCED"&&((r=o.info)==null?void 0:r.rdns)===((i=this.wallet)==null?void 0:i.rdns)||o.type==="INJECTED"||o.name===((s=this.wallet)==null?void 0:s.name)});if(n)await R.connectExternal(n,n.chain);else throw new Error("w3m-connecting-wc-browser: No connector found");Ut.close()}catch(e){e instanceof zt&&e.originalName===Ft.PROVIDER_RPC_ERROR_NAME.USER_REJECTED_REQUEST?D.sendEvent({type:"track",event:"USER_REJECTED",properties:{message:e.message}}):D.sendEvent({type:"track",event:"CONNECT_ERROR",properties:{message:(e==null?void 0:e.message)??"Unknown"}}),this.error=!0}}};Pt=Nn([T("w3m-connecting-wc-browser")],Pt);var On=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Bt=class extends k{constructor(){var e;if(super(),!this.wallet)throw new Error("w3m-connecting-wc-desktop: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.onRender=this.onRenderProxy.bind(this),D.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"desktop",displayIndex:(e=this.wallet)==null?void 0:e.display_index,walletRank:this.wallet.order,view:E.state.view}})}onRenderProxy(){var e;!this.ready&&this.uri&&(this.ready=!0,(e=this.onConnect)==null||e.call(this))}onConnectProxy(){var e;if((e=this.wallet)!=null&&e.desktop_link&&this.uri)try{this.error=!1;const{desktop_link:n,name:o}=this.wallet,{redirect:r,href:i}=_.formatNativeUrl(n,this.uri);R.setWcLinking({name:o,href:i}),R.setRecentWallet(this.wallet),_.openHref(r,"_blank")}catch{this.error=!0}}};Bt=On([T("w3m-connecting-wc-desktop")],Bt);var Re=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let he=class extends k{constructor(){var e;if(super(),this.btnLabelTimeout=void 0,this.redirectDeeplink=void 0,this.redirectUniversalLink=void 0,this.target=void 0,this.preferUniversalLinks=N.state.experimental_preferUniversalLinks,this.isLoading=!0,this.onConnect=()=>{bn.onConnectMobile(this.wallet)},!this.wallet)throw new Error("w3m-connecting-wc-mobile: No wallet provided");this.secondaryBtnLabel="Open",this.secondaryLabel=Vt.CONNECT_LABELS.MOBILE,this.secondaryBtnIcon="externalLink",this.onHandleURI(),this.unsubscribe.push(R.subscribeKey("wcUri",()=>{this.onHandleURI()})),D.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"mobile",displayIndex:(e=this.wallet)==null?void 0:e.display_index,walletRank:this.wallet.order,view:E.state.view}})}disconnectedCallback(){super.disconnectedCallback(),clearTimeout(this.btnLabelTimeout)}onHandleURI(){var e;this.isLoading=!this.uri,!this.ready&&this.uri&&(this.ready=!0,(e=this.onConnect)==null||e.call(this))}onTryAgain(){var e;R.setWcError(!1),(e=this.onConnect)==null||e.call(this)}};Re([v()],he.prototype,"redirectDeeplink",void 0);Re([v()],he.prototype,"redirectUniversalLink",void 0);Re([v()],he.prototype,"target",void 0);Re([v()],he.prototype,"preferUniversalLinks",void 0);Re([v()],he.prototype,"isLoading",void 0);he=Re([T("w3m-connecting-wc-mobile")],he);var Be={},Mn=function(){return typeof Promise=="function"&&Promise.prototype&&Promise.prototype.then},Gt={},j={};let vt;const Dn=[0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];j.getSymbolSize=function(e){if(!e)throw new Error('"version" cannot be null or undefined');if(e<1||e>40)throw new Error('"version" should be in range from 1 to 40');return e*4+17};j.getSymbolTotalCodewords=function(e){return Dn[e]};j.getBCHDigit=function(t){let e=0;for(;t!==0;)e++,t>>>=1;return e};j.setToSJISFunction=function(e){if(typeof e!="function")throw new Error('"toSJISFunc" is not a valid function.');vt=e};j.isKanjiModeEnabled=function(){return typeof vt<"u"};j.toSJIS=function(e){return vt(e)};var et={};(function(t){t.L={bit:1},t.M={bit:0},t.Q={bit:3},t.H={bit:2};function e(n){if(typeof n!="string")throw new Error("Param is not a string");switch(n.toLowerCase()){case"l":case"low":return t.L;case"m":case"medium":return t.M;case"q":case"quartile":return t.Q;case"h":case"high":return t.H;default:throw new Error("Unknown EC Level: "+n)}}t.isValid=function(o){return o&&typeof o.bit<"u"&&o.bit>=0&&o.bit<4},t.from=function(o,r){if(t.isValid(o))return o;try{return e(o)}catch{return r}}})(et);function Jt(){this.buffer=[],this.length=0}Jt.prototype={get:function(t){const e=Math.floor(t/8);return(this.buffer[e]>>>7-t%8&1)===1},put:function(t,e){for(let n=0;n<e;n++)this.putBit((t>>>e-n-1&1)===1)},getLengthInBits:function(){return this.length},putBit:function(t){const e=Math.floor(this.length/8);this.buffer.length<=e&&this.buffer.push(0),t&&(this.buffer[e]|=128>>>this.length%8),this.length++}};var jn=Jt;function Le(t){if(!t||t<1)throw new Error("BitMatrix size must be defined and greater than 0");this.size=t,this.data=new Uint8Array(t*t),this.reservedBit=new Uint8Array(t*t)}Le.prototype.set=function(t,e,n,o){const r=t*this.size+e;this.data[r]=n,o&&(this.reservedBit[r]=!0)};Le.prototype.get=function(t,e){return this.data[t*this.size+e]};Le.prototype.xor=function(t,e,n){this.data[t*this.size+e]^=n};Le.prototype.isReserved=function(t,e){return this.reservedBit[t*this.size+e]};var Un=Le,Yt={};(function(t){const e=j.getSymbolSize;t.getRowColCoords=function(o){if(o===1)return[];const r=Math.floor(o/7)+2,i=e(o),s=i===145?26:Math.ceil((i-13)/(2*r-2))*2,a=[i-7];for(let l=1;l<r-1;l++)a[l]=a[l-1]-s;return a.push(6),a.reverse()},t.getPositions=function(o){const r=[],i=t.getRowColCoords(o),s=i.length;for(let a=0;a<s;a++)for(let l=0;l<s;l++)a===0&&l===0||a===0&&l===s-1||a===s-1&&l===0||r.push([i[a],i[l]]);return r}})(Yt);var Qt={};const zn=j.getSymbolSize,Lt=7;Qt.getPositions=function(e){const n=zn(e);return[[0,0],[n-Lt,0],[0,n-Lt]]};var Xt={};(function(t){t.Patterns={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7};const e={N1:3,N2:3,N3:40,N4:10};t.isValid=function(r){return r!=null&&r!==""&&!isNaN(r)&&r>=0&&r<=7},t.from=function(r){return t.isValid(r)?parseInt(r,10):void 0},t.getPenaltyN1=function(r){const i=r.size;let s=0,a=0,l=0,u=null,w=null;for(let S=0;S<i;S++){a=l=0,u=w=null;for(let y=0;y<i;y++){let b=r.get(S,y);b===u?a++:(a>=5&&(s+=e.N1+(a-5)),u=b,a=1),b=r.get(y,S),b===w?l++:(l>=5&&(s+=e.N1+(l-5)),w=b,l=1)}a>=5&&(s+=e.N1+(a-5)),l>=5&&(s+=e.N1+(l-5))}return s},t.getPenaltyN2=function(r){const i=r.size;let s=0;for(let a=0;a<i-1;a++)for(let l=0;l<i-1;l++){const u=r.get(a,l)+r.get(a,l+1)+r.get(a+1,l)+r.get(a+1,l+1);(u===4||u===0)&&s++}return s*e.N2},t.getPenaltyN3=function(r){const i=r.size;let s=0,a=0,l=0;for(let u=0;u<i;u++){a=l=0;for(let w=0;w<i;w++)a=a<<1&2047|r.get(u,w),w>=10&&(a===1488||a===93)&&s++,l=l<<1&2047|r.get(w,u),w>=10&&(l===1488||l===93)&&s++}return s*e.N3},t.getPenaltyN4=function(r){let i=0;const s=r.data.length;for(let l=0;l<s;l++)i+=r.data[l];return Math.abs(Math.ceil(i*100/s/5)-10)*e.N4};function n(o,r,i){switch(o){case t.Patterns.PATTERN000:return(r+i)%2===0;case t.Patterns.PATTERN001:return r%2===0;case t.Patterns.PATTERN010:return i%3===0;case t.Patterns.PATTERN011:return(r+i)%3===0;case t.Patterns.PATTERN100:return(Math.floor(r/2)+Math.floor(i/3))%2===0;case t.Patterns.PATTERN101:return r*i%2+r*i%3===0;case t.Patterns.PATTERN110:return(r*i%2+r*i%3)%2===0;case t.Patterns.PATTERN111:return(r*i%3+(r+i)%2)%2===0;default:throw new Error("bad maskPattern:"+o)}}t.applyMask=function(r,i){const s=i.size;for(let a=0;a<s;a++)for(let l=0;l<s;l++)i.isReserved(l,a)||i.xor(l,a,n(r,l,a))},t.getBestMask=function(r,i){const s=Object.keys(t.Patterns).length;let a=0,l=1/0;for(let u=0;u<s;u++){i(u),t.applyMask(u,r);const w=t.getPenaltyN1(r)+t.getPenaltyN2(r)+t.getPenaltyN3(r)+t.getPenaltyN4(r);t.applyMask(u,r),w<l&&(l=w,a=u)}return a}})(Xt);var tt={};const oe=et,Oe=[1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81],Me=[7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];tt.getBlocksCount=function(e,n){switch(n){case oe.L:return Oe[(e-1)*4+0];case oe.M:return Oe[(e-1)*4+1];case oe.Q:return Oe[(e-1)*4+2];case oe.H:return Oe[(e-1)*4+3];default:return}};tt.getTotalCodewordsCount=function(e,n){switch(n){case oe.L:return Me[(e-1)*4+0];case oe.M:return Me[(e-1)*4+1];case oe.Q:return Me[(e-1)*4+2];case oe.H:return Me[(e-1)*4+3];default:return}};var Zt={},nt={};const Te=new Uint8Array(512),Ve=new Uint8Array(256);(function(){let e=1;for(let n=0;n<255;n++)Te[n]=e,Ve[e]=n,e<<=1,e&256&&(e^=285);for(let n=255;n<512;n++)Te[n]=Te[n-255]})();nt.log=function(e){if(e<1)throw new Error("log("+e+")");return Ve[e]};nt.exp=function(e){return Te[e]};nt.mul=function(e,n){return e===0||n===0?0:Te[Ve[e]+Ve[n]]};(function(t){const e=nt;t.mul=function(o,r){const i=new Uint8Array(o.length+r.length-1);for(let s=0;s<o.length;s++)for(let a=0;a<r.length;a++)i[s+a]^=e.mul(o[s],r[a]);return i},t.mod=function(o,r){let i=new Uint8Array(o);for(;i.length-r.length>=0;){const s=i[0];for(let l=0;l<r.length;l++)i[l]^=e.mul(r[l],s);let a=0;for(;a<i.length&&i[a]===0;)a++;i=i.slice(a)}return i},t.generateECPolynomial=function(o){let r=new Uint8Array([1]);for(let i=0;i<o;i++)r=t.mul(r,new Uint8Array([1,e.exp(i)]));return r}})(Zt);const en=Zt;function $t(t){this.genPoly=void 0,this.degree=t,this.degree&&this.initialize(this.degree)}$t.prototype.initialize=function(e){this.degree=e,this.genPoly=en.generateECPolynomial(this.degree)};$t.prototype.encode=function(e){if(!this.genPoly)throw new Error("Encoder not initialized");const n=new Uint8Array(e.length+this.degree);n.set(e);const o=en.mod(n,this.genPoly),r=this.degree-o.length;if(r>0){const i=new Uint8Array(this.degree);return i.set(o,r),i}return o};var Fn=$t,tn={},ae={},xt={};xt.isValid=function(e){return!isNaN(e)&&e>=1&&e<=40};var Y={};const nn="[0-9]+",Vn="[A-Z $%*+\\-./:]+";let Ae="(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";Ae=Ae.replace(/u/g,"\\u");const qn="(?:(?![A-Z0-9 $%*+\\-./:]|"+Ae+`)(?:.|[\r
]))+`;Y.KANJI=new RegExp(Ae,"g");Y.BYTE_KANJI=new RegExp("[^A-Z0-9 $%*+\\-./:]+","g");Y.BYTE=new RegExp(qn,"g");Y.NUMERIC=new RegExp(nn,"g");Y.ALPHANUMERIC=new RegExp(Vn,"g");const Hn=new RegExp("^"+Ae+"$"),Kn=new RegExp("^"+nn+"$"),Gn=new RegExp("^[A-Z0-9 $%*+\\-./:]+$");Y.testKanji=function(e){return Hn.test(e)};Y.testNumeric=function(e){return Kn.test(e)};Y.testAlphanumeric=function(e){return Gn.test(e)};(function(t){const e=xt,n=Y;t.NUMERIC={id:"Numeric",bit:1,ccBits:[10,12,14]},t.ALPHANUMERIC={id:"Alphanumeric",bit:2,ccBits:[9,11,13]},t.BYTE={id:"Byte",bit:4,ccBits:[8,16,16]},t.KANJI={id:"Kanji",bit:8,ccBits:[8,10,12]},t.MIXED={bit:-1},t.getCharCountIndicator=function(i,s){if(!i.ccBits)throw new Error("Invalid mode: "+i);if(!e.isValid(s))throw new Error("Invalid version: "+s);return s>=1&&s<10?i.ccBits[0]:s<27?i.ccBits[1]:i.ccBits[2]},t.getBestModeForData=function(i){return n.testNumeric(i)?t.NUMERIC:n.testAlphanumeric(i)?t.ALPHANUMERIC:n.testKanji(i)?t.KANJI:t.BYTE},t.toString=function(i){if(i&&i.id)return i.id;throw new Error("Invalid mode")},t.isValid=function(i){return i&&i.bit&&i.ccBits};function o(r){if(typeof r!="string")throw new Error("Param is not a string");switch(r.toLowerCase()){case"numeric":return t.NUMERIC;case"alphanumeric":return t.ALPHANUMERIC;case"kanji":return t.KANJI;case"byte":return t.BYTE;default:throw new Error("Unknown mode: "+r)}}t.from=function(i,s){if(t.isValid(i))return i;try{return o(i)}catch{return s}}})(ae);(function(t){const e=j,n=tt,o=et,r=ae,i=xt,s=7973,a=e.getBCHDigit(s);function l(y,b,$){for(let m=1;m<=40;m++)if(b<=t.getCapacity(m,$,y))return m}function u(y,b){return r.getCharCountIndicator(y,b)+4}function w(y,b){let $=0;return y.forEach(function(m){const C=u(m.mode,b);$+=C+m.getBitsLength()}),$}function S(y,b){for(let $=1;$<=40;$++)if(w(y,$)<=t.getCapacity($,b,r.MIXED))return $}t.from=function(b,$){return i.isValid(b)?parseInt(b,10):$},t.getCapacity=function(b,$,m){if(!i.isValid(b))throw new Error("Invalid QR Code version");typeof m>"u"&&(m=r.BYTE);const C=e.getSymbolTotalCodewords(b),g=n.getTotalCodewordsCount(b,$),f=(C-g)*8;if(m===r.MIXED)return f;const p=f-u(m,b);switch(m){case r.NUMERIC:return Math.floor(p/10*3);case r.ALPHANUMERIC:return Math.floor(p/11*2);case r.KANJI:return Math.floor(p/13);case r.BYTE:default:return Math.floor(p/8)}},t.getBestVersionForData=function(b,$){let m;const C=o.from($,o.M);if(Array.isArray(b)){if(b.length>1)return S(b,C);if(b.length===0)return 1;m=b[0]}else m=b;return l(m.mode,m.getLength(),C)},t.getEncodedBits=function(b){if(!i.isValid(b)||b<7)throw new Error("Invalid QR Code version");let $=b<<12;for(;e.getBCHDigit($)-a>=0;)$^=s<<e.getBCHDigit($)-a;return b<<12|$}})(tn);var on={};const gt=j,rn=1335,Jn=21522,kt=gt.getBCHDigit(rn);on.getEncodedBits=function(e,n){const o=e.bit<<3|n;let r=o<<10;for(;gt.getBCHDigit(r)-kt>=0;)r^=rn<<gt.getBCHDigit(r)-kt;return(o<<10|r)^Jn};var sn={};const Yn=ae;function be(t){this.mode=Yn.NUMERIC,this.data=t.toString()}be.getBitsLength=function(e){return 10*Math.floor(e/3)+(e%3?e%3*3+1:0)};be.prototype.getLength=function(){return this.data.length};be.prototype.getBitsLength=function(){return be.getBitsLength(this.data.length)};be.prototype.write=function(e){let n,o,r;for(n=0;n+3<=this.data.length;n+=3)o=this.data.substr(n,3),r=parseInt(o,10),e.put(r,10);const i=this.data.length-n;i>0&&(o=this.data.substr(n),r=parseInt(o,10),e.put(r,i*3+1))};var Qn=be;const Xn=ae,st=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"," ","$","%","*","+","-",".","/",":"];function ye(t){this.mode=Xn.ALPHANUMERIC,this.data=t}ye.getBitsLength=function(e){return 11*Math.floor(e/2)+6*(e%2)};ye.prototype.getLength=function(){return this.data.length};ye.prototype.getBitsLength=function(){return ye.getBitsLength(this.data.length)};ye.prototype.write=function(e){let n;for(n=0;n+2<=this.data.length;n+=2){let o=st.indexOf(this.data[n])*45;o+=st.indexOf(this.data[n+1]),e.put(o,11)}this.data.length%2&&e.put(st.indexOf(this.data[n]),6)};var Zn=ye;const ei=Rn,ti=ae;function Ce(t){this.mode=ti.BYTE,typeof t=="string"&&(t=ei(t)),this.data=new Uint8Array(t)}Ce.getBitsLength=function(e){return e*8};Ce.prototype.getLength=function(){return this.data.length};Ce.prototype.getBitsLength=function(){return Ce.getBitsLength(this.data.length)};Ce.prototype.write=function(t){for(let e=0,n=this.data.length;e<n;e++)t.put(this.data[e],8)};var ni=Ce;const ii=ae,oi=j;function ve(t){this.mode=ii.KANJI,this.data=t}ve.getBitsLength=function(e){return e*13};ve.prototype.getLength=function(){return this.data.length};ve.prototype.getBitsLength=function(){return ve.getBitsLength(this.data.length)};ve.prototype.write=function(t){let e;for(e=0;e<this.data.length;e++){let n=oi.toSJIS(this.data[e]);if(n>=33088&&n<=40956)n-=33088;else if(n>=57408&&n<=60351)n-=49472;else throw new Error("Invalid SJIS character: "+this.data[e]+`
Make sure your charset is UTF-8`);n=(n>>>8&255)*192+(n&255),t.put(n,13)}};var ri=ve;(function(t){const e=ae,n=Qn,o=Zn,r=ni,i=ri,s=Y,a=j,l=Sn;function u(g){return unescape(encodeURIComponent(g)).length}function w(g,f,p){const d=[];let x;for(;(x=g.exec(p))!==null;)d.push({data:x[0],index:x.index,mode:f,length:x[0].length});return d}function S(g){const f=w(s.NUMERIC,e.NUMERIC,g),p=w(s.ALPHANUMERIC,e.ALPHANUMERIC,g);let d,x;return a.isKanjiModeEnabled()?(d=w(s.BYTE,e.BYTE,g),x=w(s.KANJI,e.KANJI,g)):(d=w(s.BYTE_KANJI,e.BYTE,g),x=[]),f.concat(p,d,x).sort(function(B,V){return B.index-V.index}).map(function(B){return{data:B.data,mode:B.mode,length:B.length}})}function y(g,f){switch(f){case e.NUMERIC:return n.getBitsLength(g);case e.ALPHANUMERIC:return o.getBitsLength(g);case e.KANJI:return i.getBitsLength(g);case e.BYTE:return r.getBitsLength(g)}}function b(g){return g.reduce(function(f,p){const d=f.length-1>=0?f[f.length-1]:null;return d&&d.mode===p.mode?(f[f.length-1].data+=p.data,f):(f.push(p),f)},[])}function $(g){const f=[];for(let p=0;p<g.length;p++){const d=g[p];switch(d.mode){case e.NUMERIC:f.push([d,{data:d.data,mode:e.ALPHANUMERIC,length:d.length},{data:d.data,mode:e.BYTE,length:d.length}]);break;case e.ALPHANUMERIC:f.push([d,{data:d.data,mode:e.BYTE,length:d.length}]);break;case e.KANJI:f.push([d,{data:d.data,mode:e.BYTE,length:u(d.data)}]);break;case e.BYTE:f.push([{data:d.data,mode:e.BYTE,length:u(d.data)}])}}return f}function m(g,f){const p={},d={start:{}};let x=["start"];for(let A=0;A<g.length;A++){const B=g[A],V=[];for(let ie=0;ie<B.length;ie++){const G=B[ie],Se=""+A+ie;V.push(Se),p[Se]={node:G,lastCount:0},d[Se]={};for(let rt=0;rt<x.length;rt++){const X=x[rt];p[X]&&p[X].node.mode===G.mode?(d[X][Se]=y(p[X].lastCount+G.length,G.mode)-y(p[X].lastCount,G.mode),p[X].lastCount+=G.length):(p[X]&&(p[X].lastCount=G.length),d[X][Se]=y(G.length,G.mode)+4+e.getCharCountIndicator(G.mode,f))}}x=V}for(let A=0;A<x.length;A++)d[x[A]].end=0;return{map:d,table:p}}function C(g,f){let p;const d=e.getBestModeForData(g);if(p=e.from(f,d),p!==e.BYTE&&p.bit<d.bit)throw new Error('"'+g+'" cannot be encoded with mode '+e.toString(p)+`.
 Suggested mode is: `+e.toString(d));switch(p===e.KANJI&&!a.isKanjiModeEnabled()&&(p=e.BYTE),p){case e.NUMERIC:return new n(g);case e.ALPHANUMERIC:return new o(g);case e.KANJI:return new i(g);case e.BYTE:return new r(g)}}t.fromArray=function(f){return f.reduce(function(p,d){return typeof d=="string"?p.push(C(d,null)):d.data&&p.push(C(d.data,d.mode)),p},[])},t.fromString=function(f,p){const d=S(f,a.isKanjiModeEnabled()),x=$(d),A=m(x,p),B=l.find_path(A.map,"start","end"),V=[];for(let ie=1;ie<B.length-1;ie++)V.push(A.table[B[ie]].node);return t.fromArray(b(V))},t.rawSplit=function(f){return t.fromArray(S(f,a.isKanjiModeEnabled()))}})(sn);const it=j,at=et,si=jn,ai=Un,li=Yt,ci=Qt,wt=Xt,mt=tt,ui=Fn,qe=tn,di=on,hi=ae,lt=sn;function fi(t,e){const n=t.size,o=ci.getPositions(e);for(let r=0;r<o.length;r++){const i=o[r][0],s=o[r][1];for(let a=-1;a<=7;a++)if(!(i+a<=-1||n<=i+a))for(let l=-1;l<=7;l++)s+l<=-1||n<=s+l||(a>=0&&a<=6&&(l===0||l===6)||l>=0&&l<=6&&(a===0||a===6)||a>=2&&a<=4&&l>=2&&l<=4?t.set(i+a,s+l,!0,!0):t.set(i+a,s+l,!1,!0))}}function pi(t){const e=t.size;for(let n=8;n<e-8;n++){const o=n%2===0;t.set(n,6,o,!0),t.set(6,n,o,!0)}}function gi(t,e){const n=li.getPositions(e);for(let o=0;o<n.length;o++){const r=n[o][0],i=n[o][1];for(let s=-2;s<=2;s++)for(let a=-2;a<=2;a++)s===-2||s===2||a===-2||a===2||s===0&&a===0?t.set(r+s,i+a,!0,!0):t.set(r+s,i+a,!1,!0)}}function wi(t,e){const n=t.size,o=qe.getEncodedBits(e);let r,i,s;for(let a=0;a<18;a++)r=Math.floor(a/3),i=a%3+n-8-3,s=(o>>a&1)===1,t.set(r,i,s,!0),t.set(i,r,s,!0)}function ct(t,e,n){const o=t.size,r=di.getEncodedBits(e,n);let i,s;for(i=0;i<15;i++)s=(r>>i&1)===1,i<6?t.set(i,8,s,!0):i<8?t.set(i+1,8,s,!0):t.set(o-15+i,8,s,!0),i<8?t.set(8,o-i-1,s,!0):i<9?t.set(8,15-i-1+1,s,!0):t.set(8,15-i-1,s,!0);t.set(o-8,8,1,!0)}function mi(t,e){const n=t.size;let o=-1,r=n-1,i=7,s=0;for(let a=n-1;a>0;a-=2)for(a===6&&a--;;){for(let l=0;l<2;l++)if(!t.isReserved(r,a-l)){let u=!1;s<e.length&&(u=(e[s]>>>i&1)===1),t.set(r,a-l,u),i--,i===-1&&(s++,i=7)}if(r+=o,r<0||n<=r){r-=o,o=-o;break}}}function bi(t,e,n){const o=new si;n.forEach(function(l){o.put(l.mode.bit,4),o.put(l.getLength(),hi.getCharCountIndicator(l.mode,t)),l.write(o)});const r=it.getSymbolTotalCodewords(t),i=mt.getTotalCodewordsCount(t,e),s=(r-i)*8;for(o.getLengthInBits()+4<=s&&o.put(0,4);o.getLengthInBits()%8!==0;)o.putBit(0);const a=(s-o.getLengthInBits())/8;for(let l=0;l<a;l++)o.put(l%2?17:236,8);return yi(o,t,e)}function yi(t,e,n){const o=it.getSymbolTotalCodewords(e),r=mt.getTotalCodewordsCount(e,n),i=o-r,s=mt.getBlocksCount(e,n),a=o%s,l=s-a,u=Math.floor(o/s),w=Math.floor(i/s),S=w+1,y=u-w,b=new ui(y);let $=0;const m=new Array(s),C=new Array(s);let g=0;const f=new Uint8Array(t.buffer);for(let B=0;B<s;B++){const V=B<l?w:S;m[B]=f.slice($,$+V),C[B]=b.encode(m[B]),$+=V,g=Math.max(g,V)}const p=new Uint8Array(o);let d=0,x,A;for(x=0;x<g;x++)for(A=0;A<s;A++)x<m[A].length&&(p[d++]=m[A][x]);for(x=0;x<y;x++)for(A=0;A<s;A++)p[d++]=C[A][x];return p}function Ci(t,e,n,o){let r;if(Array.isArray(t))r=lt.fromArray(t);else if(typeof t=="string"){let u=e;if(!u){const w=lt.rawSplit(t);u=qe.getBestVersionForData(w,n)}r=lt.fromString(t,u||40)}else throw new Error("Invalid data");const i=qe.getBestVersionForData(r,n);if(!i)throw new Error("The amount of data is too big to be stored in a QR Code");if(!e)e=i;else if(e<i)throw new Error(`
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: `+i+`.
`);const s=bi(e,n,r),a=it.getSymbolSize(e),l=new ai(a);return fi(l,e),pi(l),gi(l,e),ct(l,n,0),e>=7&&wi(l,e),mi(l,s),isNaN(o)&&(o=wt.getBestMask(l,ct.bind(null,l,n))),wt.applyMask(o,l),ct(l,n,o),{modules:l,version:e,errorCorrectionLevel:n,maskPattern:o,segments:r}}Gt.create=function(e,n){if(typeof e>"u"||e==="")throw new Error("No input text");let o=at.M,r,i;return typeof n<"u"&&(o=at.from(n.errorCorrectionLevel,at.M),r=qe.from(n.version),i=wt.from(n.maskPattern),n.toSJISFunc&&it.setToSJISFunction(n.toSJISFunc)),Ci(e,r,o,i)};var an={},Et={};(function(t){function e(n){if(typeof n=="number"&&(n=n.toString()),typeof n!="string")throw new Error("Color should be defined as hex string");let o=n.slice().replace("#","").split("");if(o.length<3||o.length===5||o.length>8)throw new Error("Invalid hex color: "+n);(o.length===3||o.length===4)&&(o=Array.prototype.concat.apply([],o.map(function(i){return[i,i]}))),o.length===6&&o.push("F","F");const r=parseInt(o.join(""),16);return{r:r>>24&255,g:r>>16&255,b:r>>8&255,a:r&255,hex:"#"+o.slice(0,6).join("")}}t.getOptions=function(o){o||(o={}),o.color||(o.color={});const r=typeof o.margin>"u"||o.margin===null||o.margin<0?4:o.margin,i=o.width&&o.width>=21?o.width:void 0,s=o.scale||4;return{width:i,scale:i?4:s,margin:r,color:{dark:e(o.color.dark||"#000000ff"),light:e(o.color.light||"#ffffffff")},type:o.type,rendererOpts:o.rendererOpts||{}}},t.getScale=function(o,r){return r.width&&r.width>=o+r.margin*2?r.width/(o+r.margin*2):r.scale},t.getImageWidth=function(o,r){const i=t.getScale(o,r);return Math.floor((o+r.margin*2)*i)},t.qrToImageData=function(o,r,i){const s=r.modules.size,a=r.modules.data,l=t.getScale(s,i),u=Math.floor((s+i.margin*2)*l),w=i.margin*l,S=[i.color.light,i.color.dark];for(let y=0;y<u;y++)for(let b=0;b<u;b++){let $=(y*u+b)*4,m=i.color.light;if(y>=w&&b>=w&&y<u-w&&b<u-w){const C=Math.floor((y-w)/l),g=Math.floor((b-w)/l);m=S[a[C*s+g]?1:0]}o[$++]=m.r,o[$++]=m.g,o[$++]=m.b,o[$]=m.a}}})(Et);(function(t){const e=Et;function n(r,i,s){r.clearRect(0,0,i.width,i.height),i.style||(i.style={}),i.height=s,i.width=s,i.style.height=s+"px",i.style.width=s+"px"}function o(){try{return document.createElement("canvas")}catch{throw new Error("You need to specify a canvas element")}}t.render=function(i,s,a){let l=a,u=s;typeof l>"u"&&(!s||!s.getContext)&&(l=s,s=void 0),s||(u=o()),l=e.getOptions(l);const w=e.getImageWidth(i.modules.size,l),S=u.getContext("2d"),y=S.createImageData(w,w);return e.qrToImageData(y.data,i,l),n(S,u,w),S.putImageData(y,0,0),u},t.renderToDataURL=function(i,s,a){let l=a;typeof l>"u"&&(!s||!s.getContext)&&(l=s,s=void 0),l||(l={});const u=t.render(i,s,l),w=l.type||"image/png",S=l.rendererOpts||{};return u.toDataURL(w,S.quality)}})(an);var ln={};const vi=Et;function Nt(t,e){const n=t.a/255,o=e+'="'+t.hex+'"';return n<1?o+" "+e+'-opacity="'+n.toFixed(2).slice(1)+'"':o}function ut(t,e,n){let o=t+e;return typeof n<"u"&&(o+=" "+n),o}function $i(t,e,n){let o="",r=0,i=!1,s=0;for(let a=0;a<t.length;a++){const l=Math.floor(a%e),u=Math.floor(a/e);!l&&!i&&(i=!0),t[a]?(s++,a>0&&l>0&&t[a-1]||(o+=i?ut("M",l+n,.5+u+n):ut("m",r,0),r=0,i=!1),l+1<e&&t[a+1]||(o+=ut("h",s),s=0)):r++}return o}ln.render=function(e,n,o){const r=vi.getOptions(n),i=e.modules.size,s=e.modules.data,a=i+r.margin*2,l=r.color.light.a?"<path "+Nt(r.color.light,"fill")+' d="M0 0h'+a+"v"+a+'H0z"/>':"",u="<path "+Nt(r.color.dark,"stroke")+' d="'+$i(s,i,r.margin)+'"/>',w='viewBox="0 0 '+a+" "+a+'"',y='<svg xmlns="http://www.w3.org/2000/svg" '+(r.width?'width="'+r.width+'" height="'+r.width+'" ':"")+w+' shape-rendering="crispEdges">'+l+u+`</svg>
`;return typeof o=="function"&&o(null,y),y};const xi=Mn,bt=Gt,cn=an,Ei=ln;function Rt(t,e,n,o,r){const i=[].slice.call(arguments,1),s=i.length,a=typeof i[s-1]=="function";if(!a&&!xi())throw new Error("Callback required as last argument");if(a){if(s<2)throw new Error("Too few arguments provided");s===2?(r=n,n=e,e=o=void 0):s===3&&(e.getContext&&typeof r>"u"?(r=o,o=void 0):(r=o,o=n,n=e,e=void 0))}else{if(s<1)throw new Error("Too few arguments provided");return s===1?(n=e,e=o=void 0):s===2&&!e.getContext&&(o=n,n=e,e=void 0),new Promise(function(l,u){try{const w=bt.create(n,o);l(t(w,e,o))}catch(w){u(w)}})}try{const l=bt.create(n,o);r(null,t(l,e,o))}catch(l){r(l)}}Be.create=bt.create;Be.toCanvas=Rt.bind(null,cn.render);Be.toDataURL=Rt.bind(null,cn.renderToDataURL);Be.toString=Rt.bind(null,function(t,e,n){return Ei.render(t,n)});const Ri=.1,Ot=2.5,Z=7;function dt(t,e,n){return t===e?!1:(t-e<0?e-t:t-e)<=n+Ri}function Si(t,e){const n=Array.prototype.slice.call(Be.create(t,{errorCorrectionLevel:e}).modules.data,0),o=Math.sqrt(n.length);return n.reduce((r,i,s)=>(s%o===0?r.push([i]):r[r.length-1].push(i))&&r,[])}const Ti={generate({uri:t,size:e,logoSize:n,padding:o=8,dotColor:r="var(--apkt-colors-black)"}){const s=[],a=Si(t,"Q"),l=(e-2*o)/a.length,u=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];u.forEach(({x:m,y:C})=>{const g=(a.length-Z)*l*m+o,f=(a.length-Z)*l*C+o,p=.45;for(let d=0;d<u.length;d+=1){const x=l*(Z-d*2);s.push(je`
            <rect
              fill=${d===2?"var(--apkt-colors-black)":"var(--apkt-colors-white)"}
              width=${d===0?x-10:x}
              rx= ${d===0?(x-10)*p:x*p}
              ry= ${d===0?(x-10)*p:x*p}
              stroke=${r}
              stroke-width=${d===0?10:0}
              height=${d===0?x-10:x}
              x= ${d===0?f+l*d+10/2:f+l*d}
              y= ${d===0?g+l*d+10/2:g+l*d}
            />
          `)}});const w=Math.floor((n+25)/l),S=a.length/2-w/2,y=a.length/2+w/2-1,b=[];a.forEach((m,C)=>{m.forEach((g,f)=>{if(a[C][f]&&!(C<Z&&f<Z||C>a.length-(Z+1)&&f<Z||C<Z&&f>a.length-(Z+1))&&!(C>S&&C<y&&f>S&&f<y)){const p=C*l+l/2+o,d=f*l+l/2+o;b.push([p,d])}})});const $={};return b.forEach(([m,C])=>{var g;$[m]?(g=$[m])==null||g.push(C):$[m]=[C]}),Object.entries($).map(([m,C])=>{const g=C.filter(f=>C.every(p=>!dt(f,p,l)));return[Number(m),g]}).forEach(([m,C])=>{C.forEach(g=>{s.push(je`<circle cx=${m} cy=${g} fill=${r} r=${l/Ot} />`)})}),Object.entries($).filter(([m,C])=>C.length>1).map(([m,C])=>{const g=C.filter(f=>C.some(p=>dt(f,p,l)));return[Number(m),g]}).map(([m,C])=>{C.sort((f,p)=>f<p?-1:1);const g=[];for(const f of C){const p=g.find(d=>d.some(x=>dt(f,x,l)));p?p.push(f):g.push([f])}return[m,g.map(f=>[f[0],f[f.length-1]])]}).forEach(([m,C])=>{C.forEach(([g,f])=>{s.push(je`
              <line
                x1=${m}
                x2=${m}
                y1=${g}
                y2=${f}
                stroke=${r}
                stroke-width=${l/(Ot/2)}
                stroke-linecap="round"
              />
            `)})}),s}},_i=L`
  :host {
    position: relative;
    user-select: none;
    display: block;
    overflow: hidden;
    aspect-ratio: 1 / 1;
    width: 100%;
    height: 100%;
    background-color: ${({colors:t})=>t.white};
    border: 1px solid ${({tokens:t})=>t.theme.borderPrimary};
  }

  :host {
    border-radius: ${({borderRadius:t})=>t[4]};
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :host([data-clear='true']) > wui-icon {
    display: none;
  }

  svg:first-child,
  wui-image,
  wui-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translateY(-50%) translateX(-50%);
    background-color: ${({tokens:t})=>t.theme.backgroundPrimary};
    box-shadow: inset 0 0 0 4px ${({tokens:t})=>t.theme.backgroundPrimary};
    border-radius: ${({borderRadius:t})=>t[6]};
  }

  wui-image {
    width: 25%;
    height: 25%;
    border-radius: ${({borderRadius:t})=>t[2]};
  }

  wui-icon {
    width: 100%;
    height: 100%;
    color: #3396ff !important;
    transform: translateY(-50%) translateX(-50%) scale(0.25);
  }

  wui-icon > svg {
    width: inherit;
    height: inherit;
  }
`;var le=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let J=class extends I{constructor(){super(...arguments),this.uri="",this.size=500,this.theme="dark",this.imageSrc=void 0,this.alt=void 0,this.arenaClear=void 0,this.farcaster=void 0}render(){return this.dataset.theme=this.theme,this.dataset.clear=String(this.arenaClear),c`<wui-flex
      alignItems="center"
      justifyContent="center"
      class="wui-qr-code"
      direction="column"
      gap="4"
      width="100%"
      style="height: 100%"
    >
      ${this.templateVisual()} ${this.templateSvg()}
    </wui-flex>`}templateSvg(){return je`
      <svg viewBox="0 0 ${this.size} ${this.size}" width="100%" height="100%">
        ${Ti.generate({uri:this.uri,size:this.size,logoSize:this.arenaClear?0:this.size/4})}
      </svg>
    `}templateVisual(){return this.imageSrc?c`<wui-image src=${this.imageSrc} alt=${this.alt??"logo"}></wui-image>`:this.farcaster?c`<wui-icon
        class="farcaster"
        size="inherit"
        color="inherit"
        name="farcaster"
      ></wui-icon>`:c`<wui-icon size="inherit" color="inherit" name="walletConnect"></wui-icon>`}};J.styles=[H,_i];le([h()],J.prototype,"uri",void 0);le([h({type:Number})],J.prototype,"size",void 0);le([h()],J.prototype,"theme",void 0);le([h()],J.prototype,"imageSrc",void 0);le([h()],J.prototype,"alt",void 0);le([h({type:Boolean})],J.prototype,"arenaClear",void 0);le([h({type:Boolean})],J.prototype,"farcaster",void 0);J=le([T("wui-qr-code")],J);const Ii=L`
  wui-shimmer {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: ${({borderRadius:t})=>t[4]};
  }

  wui-qr-code {
    opacity: 0;
    animation-duration: ${({durations:t})=>t.xl};
    animation-timing-function: ${({easings:t})=>t["ease-out-power-2"]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;var un=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let He=class extends k{constructor(){super(),this.basic=!1}firstUpdated(){var e,n,o;this.basic||D.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:((e=this.wallet)==null?void 0:e.name)??"WalletConnect",platform:"qrcode",displayIndex:(n=this.wallet)==null?void 0:n.display_index,walletRank:(o=this.wallet)==null?void 0:o.order,view:E.state.view}})}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this.unsubscribe)==null||e.forEach(n=>n())}render(){return this.onRenderProxy(),c`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["0","5","5","5"]}
        gap="5"
      >
        <wui-shimmer width="100%"> ${this.qrCodeTemplate()} </wui-shimmer>
        <wui-text variant="lg-medium" color="primary"> Scan this QR Code with your phone </wui-text>
        ${this.copyTemplate()}
      </wui-flex>
      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}onRenderProxy(){!this.ready&&this.uri&&(this.ready=!0)}qrCodeTemplate(){if(!this.uri||!this.ready)return null;const e=this.wallet?this.wallet.name:void 0;R.setWcLinking(void 0),R.setRecentWallet(this.wallet);const n=De.state.themeVariables["--apkt-qr-color"]??De.state.themeVariables["--w3m-qr-color"];return c` <wui-qr-code
      theme=${De.state.themeMode}
      uri=${this.uri}
      imageSrc=${W(re.getWalletImage(this.wallet))}
      color=${W(n)}
      alt=${W(e)}
      data-testid="wui-qr-code"
    ></wui-qr-code>`}copyTemplate(){const e=!this.uri||!this.ready;return c`<wui-button
      .disabled=${e}
      @click=${this.onCopyUri}
      variant="neutral-secondary"
      size="sm"
      data-testid="copy-wc2-uri"
    >
      Copy link
      <wui-icon size="sm" color="inherit" name="copy" slot="iconRight"></wui-icon>
    </wui-button>`}};He.styles=Ii;un([h({type:Boolean})],He.prototype,"basic",void 0);He=un([T("w3m-connecting-wc-qrcode")],He);var Ai=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Mt=class extends I{constructor(){var e,n,o;if(super(),this.wallet=(e=E.state.data)==null?void 0:e.wallet,!this.wallet)throw new Error("w3m-connecting-wc-unsupported: No wallet provided");D.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"browser",displayIndex:(n=this.wallet)==null?void 0:n.display_index,walletRank:(o=this.wallet)==null?void 0:o.order,view:E.state.view}})}render(){return c`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["10","5","5","5"]}
        gap="5"
      >
        <wui-wallet-image
          size="lg"
          imageSrc=${W(re.getWalletImage(this.wallet))}
        ></wui-wallet-image>

        <wui-text variant="md-regular" color="primary">Not Detected</wui-text>
      </wui-flex>

      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}};Mt=Ai([T("w3m-connecting-wc-unsupported")],Mt);var dn=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let yt=class extends k{constructor(){var e,n;if(super(),this.isLoading=!0,!this.wallet)throw new Error("w3m-connecting-wc-web: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.secondaryBtnLabel="Open",this.secondaryLabel=Vt.CONNECT_LABELS.MOBILE,this.secondaryBtnIcon="externalLink",this.updateLoadingState(),this.unsubscribe.push(R.subscribeKey("wcUri",()=>{this.updateLoadingState()})),D.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"web",displayIndex:(e=this.wallet)==null?void 0:e.display_index,walletRank:(n=this.wallet)==null?void 0:n.order,view:E.state.view}})}updateLoadingState(){this.isLoading=!this.uri}onConnectProxy(){var e;if((e=this.wallet)!=null&&e.webapp_link&&this.uri)try{this.error=!1;const{webapp_link:n,name:o}=this.wallet,{redirect:r,href:i}=_.formatUniversalUrl(n,this.uri);R.setWcLinking({name:o,href:i}),R.setRecentWallet(this.wallet),_.openHref(r,"_blank")}catch{this.error=!0}}};dn([v()],yt.prototype,"isLoading",void 0);yt=dn([T("w3m-connecting-wc-web")],yt);const Wi=L`
  :host([data-mobile-fullscreen='true']) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  :host([data-mobile-fullscreen='true']) wui-ux-by-reown {
    margin-top: auto;
  }
`;var we=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let ne=class extends I{constructor(){var e;super(),this.wallet=(e=E.state.data)==null?void 0:e.wallet,this.unsubscribe=[],this.platform=void 0,this.platforms=[],this.isSiwxEnabled=!!N.state.siwx,this.remoteFeatures=N.state.remoteFeatures,this.displayBranding=!0,this.basic=!1,this.determinePlatforms(),this.initializeConnection(),this.unsubscribe.push(N.subscribeKey("remoteFeatures",n=>this.remoteFeatures=n))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return N.state.enableMobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),c`
      ${this.headerTemplate()}
      <div class="platform-container">${this.platformTemplate()}</div>
      ${this.reownBrandingTemplate()}
    `}reownBrandingTemplate(){var e;return!((e=this.remoteFeatures)!=null&&e.reownBranding)||!this.displayBranding?null:c`<wui-ux-by-reown></wui-ux-by-reown>`}async initializeConnection(e=!1){var n,o;if(!(this.platform==="browser"||N.state.manualWCControl&&!e))try{const{wcPairingExpiry:r,status:i}=R.state,{redirectView:s}=E.state.data??{};if(e||N.state.enableEmbedded||_.isPairingExpired(r)||i==="connecting"){const a=R.getConnections(ee.state.activeChain),l=(n=this.remoteFeatures)==null?void 0:n.multiWallet,u=a.length>0;await R.connectWalletConnect({cache:"never"}),this.isSiwxEnabled||(u&&l?(E.replace("ProfileWallets"),Ie.showSuccess("New Wallet Added")):s?E.replace(s):Ut.close())}}catch(r){if(r instanceof Error&&r.message.includes("An error occurred when attempting to switch chain")&&!N.state.enableNetworkSwitch&&ee.state.activeChain){ee.setActiveCaipNetwork(yn.getUnsupportedNetwork(`${ee.state.activeChain}:${(o=ee.state.activeCaipNetwork)==null?void 0:o.id}`)),ee.showUnsupportedChainUI();return}r instanceof zt&&r.originalName===Ft.PROVIDER_RPC_ERROR_NAME.USER_REJECTED_REQUEST?D.sendEvent({type:"track",event:"USER_REJECTED",properties:{message:r.message}}):D.sendEvent({type:"track",event:"CONNECT_ERROR",properties:{message:(r==null?void 0:r.message)??"Unknown"}}),R.setWcError(!0),Ie.showError(r.message??"Connection error"),R.resetWcConnection(),E.goBack()}}determinePlatforms(){if(!this.wallet){this.platforms.push("qrcode"),this.platform="qrcode";return}if(this.platform)return;const{mobile_link:e,desktop_link:n,webapp_link:o,injected:r,rdns:i}=this.wallet,s=r==null?void 0:r.map(({injected_id:$})=>$).filter(Boolean),a=[...i?[i]:s??[]],l=N.state.isUniversalProvider?!1:a.length,u=e,w=o,S=R.checkInstalled(a),y=l&&S,b=n&&!_.isMobile();y&&!ee.state.noAdapters&&this.platforms.push("browser"),u&&this.platforms.push(_.isMobile()?"mobile":"qrcode"),w&&this.platforms.push("web"),b&&this.platforms.push("desktop"),!y&&l&&!ee.state.noAdapters&&this.platforms.push("unsupported"),this.platform=this.platforms[0]}platformTemplate(){switch(this.platform){case"browser":return c`<w3m-connecting-wc-browser></w3m-connecting-wc-browser>`;case"web":return c`<w3m-connecting-wc-web></w3m-connecting-wc-web>`;case"desktop":return c`
          <w3m-connecting-wc-desktop .onRetry=${()=>this.initializeConnection(!0)}>
          </w3m-connecting-wc-desktop>
        `;case"mobile":return c`
          <w3m-connecting-wc-mobile isMobile .onRetry=${()=>this.initializeConnection(!0)}>
          </w3m-connecting-wc-mobile>
        `;case"qrcode":return c`<w3m-connecting-wc-qrcode ?basic=${this.basic}></w3m-connecting-wc-qrcode>`;default:return c`<w3m-connecting-wc-unsupported></w3m-connecting-wc-unsupported>`}}headerTemplate(){return this.platforms.length>1?c`
      <w3m-connecting-header
        .platforms=${this.platforms}
        .onSelectPlatfrom=${this.onSelectPlatform.bind(this)}
      >
      </w3m-connecting-header>
    `:null}async onSelectPlatform(e){var o;const n=(o=this.shadowRoot)==null?void 0:o.querySelector("div");n&&(await n.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.platform=e,n.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}};ne.styles=Wi;we([v()],ne.prototype,"platform",void 0);we([v()],ne.prototype,"platforms",void 0);we([v()],ne.prototype,"isSiwxEnabled",void 0);we([v()],ne.prototype,"remoteFeatures",void 0);we([h({type:Boolean})],ne.prototype,"displayBranding",void 0);we([h({type:Boolean})],ne.prototype,"basic",void 0);ne=we([T("w3m-connecting-wc-view")],ne);var St=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Ke=class extends I{constructor(){super(),this.unsubscribe=[],this.isMobile=_.isMobile(),this.remoteFeatures=N.state.remoteFeatures,this.unsubscribe.push(N.subscribeKey("remoteFeatures",e=>this.remoteFeatures=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){if(this.isMobile){const{featured:e,recommended:n}=P.state,{customWallets:o}=N.state,r=Cn.getRecentWallets(),i=e.length||n.length||(o==null?void 0:o.length)||r.length;return c`<wui-flex flexDirection="column" gap="2" .margin=${["1","3","3","3"]}>
        ${i?c`<w3m-connector-list></w3m-connector-list>`:null}
        <w3m-all-wallets-widget></w3m-all-wallets-widget>
      </wui-flex>`}return c`<wui-flex flexDirection="column" .padding=${["0","0","4","0"]}>
        <w3m-connecting-wc-view ?basic=${!0} .displayBranding=${!1}></w3m-connecting-wc-view>
        <wui-flex flexDirection="column" .padding=${["0","3","0","3"]}>
          <w3m-all-wallets-widget></w3m-all-wallets-widget>
        </wui-flex>
      </wui-flex>
      ${this.reownBrandingTemplate()} `}reownBrandingTemplate(){var e;return(e=this.remoteFeatures)!=null&&e.reownBranding?c` <wui-flex flexDirection="column" .padding=${["1","0","1","0"]}>
      <wui-ux-by-reown></wui-ux-by-reown>
    </wui-flex>`:null}};St([v()],Ke.prototype,"isMobile",void 0);St([v()],Ke.prototype,"remoteFeatures",void 0);Ke=St([T("w3m-connecting-wc-basic-view")],Ke);/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Pi=t=>t.strings===void 0;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const _e=(t,e)=>{var o;const n=t._$AN;if(n===void 0)return!1;for(const r of n)(o=r._$AO)==null||o.call(r,e,!1),_e(r,e);return!0},Ge=t=>{let e,n;do{if((e=t._$AM)===void 0)break;n=e._$AN,n.delete(t),t=e}while((n==null?void 0:n.size)===0)},hn=t=>{for(let e;e=t._$AM;t=e){let n=e._$AN;if(n===void 0)e._$AN=n=new Set;else if(n.has(t))break;n.add(t),ki(e)}};function Bi(t){this._$AN!==void 0?(Ge(this),this._$AM=t,hn(this)):this._$AM=t}function Li(t,e=!1,n=0){const o=this._$AH,r=this._$AN;if(r!==void 0&&r.size!==0)if(e)if(Array.isArray(o))for(let i=n;i<o.length;i++)_e(o[i],!1),Ge(o[i]);else o!=null&&(_e(o,!1),Ge(o));else _e(this,t)}const ki=t=>{t.type==$n.CHILD&&(t._$AP??(t._$AP=Li),t._$AQ??(t._$AQ=Bi))};class Ni extends vn{constructor(){super(...arguments),this._$AN=void 0}_$AT(e,n,o){super._$AT(e,n,o),hn(this),this.isConnected=e._$AU}_$AO(e,n=!0){var o,r;e!==this.isConnected&&(this.isConnected=e,e?(o=this.reconnected)==null||o.call(this):(r=this.disconnected)==null||r.call(this)),n&&(_e(this,e),Ge(this))}setValue(e){if(Pi(this._$Ct))this._$Ct._$AI(e,this);else{const n=[...this._$Ct._$AH];n[this._$Ci]=e,this._$Ct._$AI(n,this,0)}}disconnected(){}reconnected(){}}/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const Tt=()=>new Oi;class Oi{}const ht=new WeakMap,_t=xn(class extends Ni{render(t){return Wt}update(t,[e]){var o;const n=e!==this.G;return n&&this.G!==void 0&&this.rt(void 0),(n||this.lt!==this.ct)&&(this.G=e,this.ht=(o=t.options)==null?void 0:o.host,this.rt(this.ct=t.element)),Wt}rt(t){if(this.isConnected||(t=void 0),typeof this.G=="function"){const e=this.ht??globalThis;let n=ht.get(e);n===void 0&&(n=new WeakMap,ht.set(e,n)),n.get(this.G)!==void 0&&this.G.call(this.ht,void 0),n.set(this.G,t),t!==void 0&&this.G.call(this.ht,t)}else this.G.value=t}get lt(){var t,e;return typeof this.G=="function"?(t=ht.get(this.ht??globalThis))==null?void 0:t.get(this.G):(e=this.G)==null?void 0:e.value}disconnected(){this.lt===this.ct&&this.rt(void 0)}reconnected(){this.rt(this.ct)}}),Mi=L`
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  label {
    position: relative;
    display: inline-block;
    user-select: none;
    transition:
      background-color ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-2"]},
      color ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      border ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      box-shadow ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-2"]},
      width ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      height ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      transform ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-2"]},
      opacity ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]};
    will-change: background-color, color, border, box-shadow, width, height, transform, opacity;
  }

  input {
    width: 0;
    height: 0;
    opacity: 0;
  }

  span {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: ${({colors:t})=>t.neutrals300};
    border-radius: ${({borderRadius:t})=>t.round};
    border: 1px solid transparent;
    will-change: border;
    transition:
      background-color ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-2"]},
      color ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      border ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      box-shadow ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-2"]},
      width ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      height ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]},
      transform ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-2"]},
      opacity ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-2"]};
    will-change: background-color, color, border, box-shadow, width, height, transform, opacity;
  }

  span:before {
    content: '';
    position: absolute;
    background-color: ${({colors:t})=>t.white};
    border-radius: 50%;
  }

  /* -- Sizes --------------------------------------------------------- */
  label[data-size='lg'] {
    width: 48px;
    height: 32px;
  }

  label[data-size='md'] {
    width: 40px;
    height: 28px;
  }

  label[data-size='sm'] {
    width: 32px;
    height: 22px;
  }

  label[data-size='lg'] > span:before {
    height: 24px;
    width: 24px;
    left: 4px;
    top: 3px;
  }

  label[data-size='md'] > span:before {
    height: 20px;
    width: 20px;
    left: 4px;
    top: 3px;
  }

  label[data-size='sm'] > span:before {
    height: 16px;
    width: 16px;
    left: 3px;
    top: 2px;
  }

  /* -- Focus states --------------------------------------------------- */
  input:focus-visible:not(:checked) + span,
  input:focus:not(:checked) + span {
    border: 1px solid ${({tokens:t})=>t.core.iconAccentPrimary};
    background-color: ${({tokens:t})=>t.theme.textTertiary};
    box-shadow: 0px 0px 0px 4px rgba(9, 136, 240, 0.2);
  }

  input:focus-visible:checked + span,
  input:focus:checked + span {
    border: 1px solid ${({tokens:t})=>t.core.iconAccentPrimary};
    box-shadow: 0px 0px 0px 4px rgba(9, 136, 240, 0.2);
  }

  /* -- Checked states --------------------------------------------------- */
  input:checked + span {
    background-color: ${({tokens:t})=>t.core.iconAccentPrimary};
  }

  label[data-size='lg'] > input:checked + span:before {
    transform: translateX(calc(100% - 9px));
  }

  label[data-size='md'] > input:checked + span:before {
    transform: translateX(calc(100% - 9px));
  }

  label[data-size='sm'] > input:checked + span:before {
    transform: translateX(calc(100% - 7px));
  }

  /* -- Hover states ------------------------------------------------------- */
  label:hover > input:not(:checked):not(:disabled) + span {
    background-color: ${({colors:t})=>t.neutrals400};
  }

  label:hover > input:checked:not(:disabled) + span {
    background-color: ${({colors:t})=>t.accent080};
  }

  /* -- Disabled state --------------------------------------------------- */
  label:has(input:disabled) {
    pointer-events: none;
    user-select: none;
  }

  input:not(:checked):disabled + span {
    background-color: ${({colors:t})=>t.neutrals700};
  }

  input:checked:disabled + span {
    background-color: ${({colors:t})=>t.neutrals700};
  }

  input:not(:checked):disabled + span::before {
    background-color: ${({colors:t})=>t.neutrals400};
  }

  input:checked:disabled + span::before {
    background-color: ${({tokens:t})=>t.theme.textTertiary};
  }
`;var ot=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let $e=class extends I{constructor(){super(...arguments),this.inputElementRef=Tt(),this.checked=!1,this.disabled=!1,this.size="md"}render(){return c`
      <label data-size=${this.size}>
        <input
          ${_t(this.inputElementRef)}
          type="checkbox"
          ?checked=${this.checked}
          ?disabled=${this.disabled}
          @change=${this.dispatchChangeEvent.bind(this)}
        />
        <span></span>
      </label>
    `}dispatchChangeEvent(){var e;this.dispatchEvent(new CustomEvent("switchChange",{detail:(e=this.inputElementRef.value)==null?void 0:e.checked,bubbles:!0,composed:!0}))}};$e.styles=[H,ge,Mi];ot([h({type:Boolean})],$e.prototype,"checked",void 0);ot([h({type:Boolean})],$e.prototype,"disabled",void 0);ot([h()],$e.prototype,"size",void 0);$e=ot([T("wui-toggle")],$e);const Di=L`
  :host {
    height: auto;
  }

  :host > wui-flex {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    column-gap: ${({spacing:t})=>t[2]};
    padding: ${({spacing:t})=>t[2]} ${({spacing:t})=>t[3]};
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
    border-radius: ${({borderRadius:t})=>t[4]};
    box-shadow: inset 0 0 0 1px ${({tokens:t})=>t.theme.foregroundPrimary};
    transition: background-color ${({durations:t})=>t.lg}
      ${({easings:t})=>t["ease-out-power-2"]};
    will-change: background-color;
    cursor: pointer;
  }

  wui-switch {
    pointer-events: none;
  }
`;var fn=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Je=class extends I{constructor(){super(...arguments),this.checked=!1}render(){return c`
      <wui-flex>
        <wui-icon size="xl" name="walletConnectBrown"></wui-icon>
        <wui-toggle
          ?checked=${this.checked}
          size="sm"
          @switchChange=${this.handleToggleChange.bind(this)}
        ></wui-toggle>
      </wui-flex>
    `}handleToggleChange(e){e.stopPropagation(),this.checked=e.detail,this.dispatchSwitchEvent()}dispatchSwitchEvent(){this.dispatchEvent(new CustomEvent("certifiedSwitchChange",{detail:this.checked,bubbles:!0,composed:!0}))}};Je.styles=[H,ge,Di];fn([h({type:Boolean})],Je.prototype,"checked",void 0);Je=fn([T("wui-certified-switch")],Je);const ji=L`
  :host {
    position: relative;
    width: 100%;
    display: inline-flex;
    flex-direction: column;
    gap: ${({spacing:t})=>t[3]};
    color: ${({tokens:t})=>t.theme.textPrimary};
    caret-color: ${({tokens:t})=>t.core.textAccentPrimary};
  }

  .wui-input-text-container {
    position: relative;
    display: flex;
  }

  input {
    width: 100%;
    border-radius: ${({borderRadius:t})=>t[4]};
    color: inherit;
    background: transparent;
    border: 1px solid ${({tokens:t})=>t.theme.borderPrimary};
    caret-color: ${({tokens:t})=>t.core.textAccentPrimary};
    padding: ${({spacing:t})=>t[3]} ${({spacing:t})=>t[3]}
      ${({spacing:t})=>t[3]} ${({spacing:t})=>t[10]};
    font-size: ${({textSize:t})=>t.large};
    line-height: ${({typography:t})=>t["lg-regular"].lineHeight};
    letter-spacing: ${({typography:t})=>t["lg-regular"].letterSpacing};
    font-weight: ${({fontWeight:t})=>t.regular};
    font-family: ${({fontFamily:t})=>t.regular};
  }

  input[data-size='lg'] {
    padding: ${({spacing:t})=>t[4]} ${({spacing:t})=>t[3]}
      ${({spacing:t})=>t[4]} ${({spacing:t})=>t[10]};
  }

  @media (hover: hover) and (pointer: fine) {
    input:hover:enabled {
      border: 1px solid ${({tokens:t})=>t.theme.borderSecondary};
    }
  }

  input:disabled {
    cursor: unset;
    border: 1px solid ${({tokens:t})=>t.theme.borderPrimary};
  }

  input::placeholder {
    color: ${({tokens:t})=>t.theme.textSecondary};
  }

  input:focus:enabled {
    border: 1px solid ${({tokens:t})=>t.theme.borderSecondary};
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
    -webkit-box-shadow: 0px 0px 0px 4px ${({tokens:t})=>t.core.foregroundAccent040};
    -moz-box-shadow: 0px 0px 0px 4px ${({tokens:t})=>t.core.foregroundAccent040};
    box-shadow: 0px 0px 0px 4px ${({tokens:t})=>t.core.foregroundAccent040};
  }

  div.wui-input-text-container:has(input:disabled) {
    opacity: 0.5;
  }

  wui-icon.wui-input-text-left-icon {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    left: ${({spacing:t})=>t[4]};
    color: ${({tokens:t})=>t.theme.iconDefault};
  }

  button.wui-input-text-submit-button {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: ${({spacing:t})=>t[3]};
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    border-radius: ${({borderRadius:t})=>t[2]};
    color: ${({tokens:t})=>t.core.textAccentPrimary};
  }

  button.wui-input-text-submit-button:disabled {
    opacity: 1;
  }

  button.wui-input-text-submit-button.loading wui-icon {
    animation: spin 1s linear infinite;
  }

  button.wui-input-text-submit-button:hover {
    background: ${({tokens:t})=>t.core.foregroundAccent010};
  }

  input:has(+ .wui-input-text-submit-button) {
    padding-right: ${({spacing:t})=>t[12]};
  }

  input[type='number'] {
    -moz-appearance: textfield;
  }

  input[type='search']::-webkit-search-decoration,
  input[type='search']::-webkit-search-cancel-button,
  input[type='search']::-webkit-search-results-button,
  input[type='search']::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }

  /* -- Keyframes --------------------------------------------------- */
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;var z=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let O=class extends I{constructor(){super(...arguments),this.inputElementRef=Tt(),this.disabled=!1,this.loading=!1,this.placeholder="",this.type="text",this.value="",this.size="md"}render(){return c` <div class="wui-input-text-container">
        ${this.templateLeftIcon()}
        <input
          data-size=${this.size}
          ${_t(this.inputElementRef)}
          data-testid="wui-input-text"
          type=${this.type}
          enterkeyhint=${W(this.enterKeyHint)}
          ?disabled=${this.disabled}
          placeholder=${this.placeholder}
          @input=${this.dispatchInputChangeEvent.bind(this)}
          @keydown=${this.onKeyDown}
          .value=${this.value||""}
        />
        ${this.templateSubmitButton()}
        <slot class="wui-input-text-slot"></slot>
      </div>
      ${this.templateError()} ${this.templateWarning()}`}templateLeftIcon(){return this.icon?c`<wui-icon
        class="wui-input-text-left-icon"
        size="md"
        data-size=${this.size}
        color="inherit"
        name=${this.icon}
      ></wui-icon>`:null}templateSubmitButton(){var e;return this.onSubmit?c`<button
        class="wui-input-text-submit-button ${this.loading?"loading":""}"
        @click=${(e=this.onSubmit)==null?void 0:e.bind(this)}
        ?disabled=${this.disabled||this.loading}
      >
        ${this.loading?c`<wui-icon name="spinner" size="md"></wui-icon>`:c`<wui-icon name="chevronRight" size="md"></wui-icon>`}
      </button>`:null}templateError(){return this.errorText?c`<wui-text variant="sm-regular" color="error">${this.errorText}</wui-text>`:null}templateWarning(){return this.warningText?c`<wui-text variant="sm-regular" color="warning">${this.warningText}</wui-text>`:null}dispatchInputChangeEvent(){var e;this.dispatchEvent(new CustomEvent("inputChange",{detail:(e=this.inputElementRef.value)==null?void 0:e.value,bubbles:!0,composed:!0}))}};O.styles=[H,ge,ji];z([h()],O.prototype,"icon",void 0);z([h({type:Boolean})],O.prototype,"disabled",void 0);z([h({type:Boolean})],O.prototype,"loading",void 0);z([h()],O.prototype,"placeholder",void 0);z([h()],O.prototype,"type",void 0);z([h()],O.prototype,"value",void 0);z([h()],O.prototype,"errorText",void 0);z([h()],O.prototype,"warningText",void 0);z([h()],O.prototype,"onSubmit",void 0);z([h()],O.prototype,"size",void 0);z([h({attribute:!1})],O.prototype,"onKeyDown",void 0);O=z([T("wui-input-text")],O);const Ui=L`
  :host {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  wui-icon {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: ${({spacing:t})=>t[3]};
    color: ${({tokens:t})=>t.theme.iconDefault};
    cursor: pointer;
    padding: ${({spacing:t})=>t[2]};
    background-color: transparent;
    border-radius: ${({borderRadius:t})=>t[4]};
    transition: background-color ${({durations:t})=>t.lg}
      ${({easings:t})=>t["ease-out-power-2"]};
  }

  @media (hover: hover) {
    wui-icon:hover {
      background-color: ${({tokens:t})=>t.theme.foregroundSecondary};
    }
  }
`;var pn=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Ye=class extends I{constructor(){super(...arguments),this.inputComponentRef=Tt(),this.inputValue=""}render(){return c`
      <wui-input-text
        ${_t(this.inputComponentRef)}
        placeholder="Search wallet"
        icon="search"
        type="search"
        enterKeyHint="search"
        size="sm"
        @inputChange=${this.onInputChange}
      >
        ${this.inputValue?c`<wui-icon
              @click=${this.clearValue}
              color="inherit"
              size="sm"
              name="close"
            ></wui-icon>`:null}
      </wui-input-text>
    `}onInputChange(e){this.inputValue=e.detail||""}clearValue(){const e=this.inputComponentRef.value,n=e==null?void 0:e.inputElementRef.value;n&&(n.value="",this.inputValue="",n.focus(),n.dispatchEvent(new Event("input")))}};Ye.styles=[H,Ui];pn([h()],Ye.prototype,"inputValue",void 0);Ye=pn([T("wui-search-bar")],Ye);const zi=L`
  :host {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 104px;
    width: 104px;
    row-gap: ${({spacing:t})=>t[2]};
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
    border-radius: ${({borderRadius:t})=>t[5]};
    position: relative;
  }

  wui-shimmer[data-type='network'] {
    border: none;
    -webkit-clip-path: var(--apkt-path-network);
    clip-path: var(--apkt-path-network);
  }

  svg {
    position: absolute;
    width: 48px;
    height: 54px;
    z-index: 1;
  }

  svg > path {
    stroke: ${({tokens:t})=>t.theme.foregroundSecondary};
    stroke-width: 1px;
  }

  @media (max-width: 350px) {
    :host {
      width: 100%;
    }
  }
`;var gn=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Qe=class extends I{constructor(){super(...arguments),this.type="wallet"}render(){return c`
      ${this.shimmerTemplate()}
      <wui-shimmer width="80px" height="20px"></wui-shimmer>
    `}shimmerTemplate(){return this.type==="network"?c` <wui-shimmer data-type=${this.type} width="48px" height="54px"></wui-shimmer>
        ${En}`:c`<wui-shimmer width="56px" height="56px"></wui-shimmer>`}};Qe.styles=[H,ge,zi];gn([h()],Qe.prototype,"type",void 0);Qe=gn([T("wui-card-select-loader")],Qe);const Fi=qt`
  :host {
    display: grid;
    width: inherit;
    height: inherit;
  }
`;var F=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let M=class extends I{render(){return this.style.cssText=`
      grid-template-rows: ${this.gridTemplateRows};
      grid-template-columns: ${this.gridTemplateColumns};
      justify-items: ${this.justifyItems};
      align-items: ${this.alignItems};
      justify-content: ${this.justifyContent};
      align-content: ${this.alignContent};
      column-gap: ${this.columnGap&&`var(--apkt-spacing-${this.columnGap})`};
      row-gap: ${this.rowGap&&`var(--apkt-spacing-${this.rowGap})`};
      gap: ${this.gap&&`var(--apkt-spacing-${this.gap})`};
      padding-top: ${this.padding&&te.getSpacingStyles(this.padding,0)};
      padding-right: ${this.padding&&te.getSpacingStyles(this.padding,1)};
      padding-bottom: ${this.padding&&te.getSpacingStyles(this.padding,2)};
      padding-left: ${this.padding&&te.getSpacingStyles(this.padding,3)};
      margin-top: ${this.margin&&te.getSpacingStyles(this.margin,0)};
      margin-right: ${this.margin&&te.getSpacingStyles(this.margin,1)};
      margin-bottom: ${this.margin&&te.getSpacingStyles(this.margin,2)};
      margin-left: ${this.margin&&te.getSpacingStyles(this.margin,3)};
    `,c`<slot></slot>`}};M.styles=[H,Fi];F([h()],M.prototype,"gridTemplateRows",void 0);F([h()],M.prototype,"gridTemplateColumns",void 0);F([h()],M.prototype,"justifyItems",void 0);F([h()],M.prototype,"alignItems",void 0);F([h()],M.prototype,"justifyContent",void 0);F([h()],M.prototype,"alignContent",void 0);F([h()],M.prototype,"columnGap",void 0);F([h()],M.prototype,"rowGap",void 0);F([h()],M.prototype,"gap",void 0);F([h()],M.prototype,"padding",void 0);F([h()],M.prototype,"margin",void 0);M=F([T("wui-grid")],M);const Vi=L`
  button {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    width: 104px;
    row-gap: ${({spacing:t})=>t[2]};
    padding: ${({spacing:t})=>t[3]} ${({spacing:t})=>t[0]};
    background-color: ${({tokens:t})=>t.theme.foregroundPrimary};
    border-radius: clamp(0px, ${({borderRadius:t})=>t[4]}, 20px);
    transition:
      color ${({durations:t})=>t.lg} ${({easings:t})=>t["ease-out-power-1"]},
      background-color ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-1"]},
      border-radius ${({durations:t})=>t.lg}
        ${({easings:t})=>t["ease-out-power-1"]};
    will-change: background-color, color, border-radius;
    outline: none;
    border: none;
  }

  button > wui-flex > wui-text {
    color: ${({tokens:t})=>t.theme.textPrimary};
    max-width: 86px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    justify-content: center;
  }

  button > wui-flex > wui-text.certified {
    max-width: 66px;
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover:enabled {
      background-color: ${({tokens:t})=>t.theme.foregroundSecondary};
    }
  }

  button:disabled > wui-flex > wui-text {
    color: ${({tokens:t})=>t.core.glass010};
  }

  [data-selected='true'] {
    background-color: ${({colors:t})=>t.accent020};
  }

  @media (hover: hover) and (pointer: fine) {
    [data-selected='true']:hover:enabled {
      background-color: ${({colors:t})=>t.accent010};
    }
  }

  [data-selected='true']:active:enabled {
    background-color: ${({colors:t})=>t.accent010};
  }

  @media (max-width: 350px) {
    button {
      width: 100%;
    }
  }
`;var Q=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let U=class extends I{constructor(){super(),this.observer=new IntersectionObserver(()=>{}),this.visible=!1,this.imageSrc=void 0,this.imageLoading=!1,this.isImpressed=!1,this.explorerId="",this.walletQuery="",this.certified=!1,this.displayIndex=0,this.wallet=void 0,this.observer=new IntersectionObserver(e=>{e.forEach(n=>{n.isIntersecting?(this.visible=!0,this.fetchImageSrc(),this.sendImpressionEvent()):this.visible=!1})},{threshold:.01})}firstUpdated(){this.observer.observe(this)}disconnectedCallback(){this.observer.disconnect()}render(){var n,o;const e=((n=this.wallet)==null?void 0:n.badge_type)==="certified";return c`
      <button>
        ${this.imageTemplate()}
        <wui-flex flexDirection="row" alignItems="center" justifyContent="center" gap="1">
          <wui-text
            variant="md-regular"
            color="inherit"
            class=${W(e?"certified":void 0)}
            >${(o=this.wallet)==null?void 0:o.name}</wui-text
          >
          ${e?c`<wui-icon size="sm" name="walletConnectBrown"></wui-icon>`:null}
        </wui-flex>
      </button>
    `}imageTemplate(){var e,n;return!this.visible&&!this.imageSrc||this.imageLoading?this.shimmerTemplate():c`
      <wui-wallet-image
        size="lg"
        imageSrc=${W(this.imageSrc)}
        name=${W((e=this.wallet)==null?void 0:e.name)}
        .installed=${((n=this.wallet)==null?void 0:n.installed)??!1}
        badgeSize="sm"
      >
      </wui-wallet-image>
    `}shimmerTemplate(){return c`<wui-shimmer width="56px" height="56px"></wui-shimmer>`}async fetchImageSrc(){this.wallet&&(this.imageSrc=re.getWalletImage(this.wallet),!this.imageSrc&&(this.imageLoading=!0,this.imageSrc=await re.fetchWalletImage(this.wallet.image_id),this.imageLoading=!1))}sendImpressionEvent(){!this.wallet||this.isImpressed||(this.isImpressed=!0,D.sendWalletImpressionEvent({name:this.wallet.name,walletRank:this.wallet.order,explorerId:this.explorerId,view:E.state.view,query:this.walletQuery,certified:this.certified,displayIndex:this.displayIndex}))}};U.styles=Vi;Q([v()],U.prototype,"visible",void 0);Q([v()],U.prototype,"imageSrc",void 0);Q([v()],U.prototype,"imageLoading",void 0);Q([v()],U.prototype,"isImpressed",void 0);Q([h()],U.prototype,"explorerId",void 0);Q([h()],U.prototype,"walletQuery",void 0);Q([h()],U.prototype,"certified",void 0);Q([h()],U.prototype,"displayIndex",void 0);Q([h({type:Object})],U.prototype,"wallet",void 0);U=Q([T("w3m-all-wallets-list-item")],U);const qi=L`
  wui-grid {
    max-height: clamp(360px, 400px, 80vh);
    overflow: scroll;
    scrollbar-width: none;
    grid-auto-rows: min-content;
    grid-template-columns: repeat(auto-fill, 104px);
  }

  :host([data-mobile-fullscreen='true']) wui-grid {
    max-height: none;
  }

  @media (max-width: 350px) {
    wui-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  wui-grid[data-scroll='false'] {
    overflow: hidden;
  }

  wui-grid::-webkit-scrollbar {
    display: none;
  }

  w3m-all-wallets-list-item {
    opacity: 0;
    animation-duration: ${({durations:t})=>t.xl};
    animation-timing-function: ${({easings:t})=>t["ease-inout-power-2"]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  wui-loading-spinner {
    padding-top: ${({spacing:t})=>t[4]};
    padding-bottom: ${({spacing:t})=>t[4]};
    justify-content: center;
    grid-column: 1 / span 4;
  }
`;var ke=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};const Dt="local-paginator";let fe=class extends I{constructor(){super(),this.unsubscribe=[],this.paginationObserver=void 0,this.loading=!P.state.wallets.length,this.wallets=P.state.wallets,this.mobileFullScreen=N.state.enableMobileFullScreen,this.unsubscribe.push(P.subscribeKey("wallets",e=>this.wallets=e))}firstUpdated(){this.initialFetch(),this.createPaginationObserver()}disconnectedCallback(){var e;this.unsubscribe.forEach(n=>n()),(e=this.paginationObserver)==null||e.disconnect()}render(){return this.mobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),c`
      <wui-grid
        data-scroll=${!this.loading}
        .padding=${["0","3","3","3"]}
        gap="2"
        justifyContent="space-between"
      >
        ${this.loading?this.shimmerTemplate(16):this.walletsTemplate()}
        ${this.paginationLoaderTemplate()}
      </wui-grid>
    `}async initialFetch(){var n;this.loading=!0;const e=(n=this.shadowRoot)==null?void 0:n.querySelector("wui-grid");e&&(await P.fetchWalletsByPage({page:1}),await e.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.loading=!1,e.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}shimmerTemplate(e,n){return[...Array(e)].map(()=>c`
        <wui-card-select-loader type="wallet" id=${W(n)}></wui-card-select-loader>
      `)}walletsTemplate(){return pt.getWalletConnectWallets(this.wallets).map((e,n)=>c`
        <w3m-all-wallets-list-item
          data-testid="wallet-search-item-${e.id}"
          @click=${()=>this.onConnectWallet(e)}
          .wallet=${e}
          explorerId=${e.id}
          certified=${this.badge==="certified"}
          displayIndex=${n}
        ></w3m-all-wallets-list-item>
      `)}paginationLoaderTemplate(){const{wallets:e,recommended:n,featured:o,count:r,mobileFilteredOutWalletsLength:i}=P.state,s=window.innerWidth<352?3:4,a=e.length+n.length;let u=Math.ceil(a/s)*s-a+s;return u-=e.length?o.length%s:0,r===0&&o.length>0?null:r===0||[...o,...e,...n].length<r-(i??0)?this.shimmerTemplate(u,Dt):null}createPaginationObserver(){var n;const e=(n=this.shadowRoot)==null?void 0:n.querySelector(`#${Dt}`);e&&(this.paginationObserver=new IntersectionObserver(([o])=>{if(o!=null&&o.isIntersecting&&!this.loading){const{page:r,count:i,wallets:s}=P.state;s.length<i&&P.fetchWalletsByPage({page:r+1})}}),this.paginationObserver.observe(e))}onConnectWallet(e){q.selectWalletConnector(e)}};fe.styles=qi;ke([v()],fe.prototype,"loading",void 0);ke([v()],fe.prototype,"wallets",void 0);ke([v()],fe.prototype,"badge",void 0);ke([v()],fe.prototype,"mobileFullScreen",void 0);fe=ke([T("w3m-all-wallets-list")],fe);const Hi=qt`
  wui-grid,
  wui-loading-spinner,
  wui-flex {
    height: 360px;
  }

  wui-grid {
    overflow: scroll;
    scrollbar-width: none;
    grid-auto-rows: min-content;
    grid-template-columns: repeat(auto-fill, 104px);
  }

  :host([data-mobile-fullscreen='true']) wui-grid {
    max-height: none;
    height: auto;
  }

  wui-grid[data-scroll='false'] {
    overflow: hidden;
  }

  wui-grid::-webkit-scrollbar {
    display: none;
  }

  wui-loading-spinner {
    justify-content: center;
    align-items: center;
  }

  @media (max-width: 350px) {
    wui-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
`;var Ne=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let pe=class extends I{constructor(){super(...arguments),this.prevQuery="",this.prevBadge=void 0,this.loading=!0,this.mobileFullScreen=N.state.enableMobileFullScreen,this.query=""}render(){return this.mobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),this.onSearch(),this.loading?c`<wui-loading-spinner color="accent-primary"></wui-loading-spinner>`:this.walletsTemplate()}async onSearch(){(this.query.trim()!==this.prevQuery.trim()||this.badge!==this.prevBadge)&&(this.prevQuery=this.query,this.prevBadge=this.badge,this.loading=!0,await P.searchWallet({search:this.query,badge:this.badge}),this.loading=!1)}walletsTemplate(){const{search:e}=P.state,n=pt.markWalletsAsInstalled(e),o=pt.filterWalletsByWcSupport(n);return o.length?c`
      <wui-grid
        data-testid="wallet-list"
        .padding=${["0","3","3","3"]}
        rowGap="4"
        columngap="2"
        justifyContent="space-between"
      >
        ${o.map((r,i)=>c`
            <w3m-all-wallets-list-item
              @click=${()=>this.onConnectWallet(r)}
              .wallet=${r}
              data-testid="wallet-search-item-${r.id}"
              explorerId=${r.id}
              certified=${this.badge==="certified"}
              walletQuery=${this.query}
              displayIndex=${i}
            ></w3m-all-wallets-list-item>
          `)}
      </wui-grid>
    `:c`
        <wui-flex
          data-testid="no-wallet-found"
          justifyContent="center"
          alignItems="center"
          gap="3"
          flexDirection="column"
        >
          <wui-icon-box size="lg" color="default" icon="wallet"></wui-icon-box>
          <wui-text data-testid="no-wallet-found-text" color="secondary" variant="md-medium">
            No Wallet found
          </wui-text>
        </wui-flex>
      `}onConnectWallet(e){q.selectWalletConnector(e)}};pe.styles=Hi;Ne([v()],pe.prototype,"loading",void 0);Ne([v()],pe.prototype,"mobileFullScreen",void 0);Ne([h()],pe.prototype,"query",void 0);Ne([h()],pe.prototype,"badge",void 0);pe=Ne([T("w3m-all-wallets-search")],pe);var It=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let Xe=class extends I{constructor(){super(...arguments),this.search="",this.badge=void 0,this.onDebouncedSearch=_.debounce(e=>{this.search=e})}render(){const e=this.search.length>=2;return c`
      <wui-flex .padding=${["1","3","3","3"]} gap="2" alignItems="center">
        <wui-search-bar @inputChange=${this.onInputChange.bind(this)}></wui-search-bar>
        <wui-certified-switch
          ?checked=${this.badge==="certified"}
          @certifiedSwitchChange=${this.onCertifiedSwitchChange.bind(this)}
          data-testid="wui-certified-switch"
        ></wui-certified-switch>
        ${this.qrButtonTemplate()}
      </wui-flex>
      ${e||this.badge?c`<w3m-all-wallets-search
            query=${this.search}
            .badge=${this.badge}
          ></w3m-all-wallets-search>`:c`<w3m-all-wallets-list .badge=${this.badge}></w3m-all-wallets-list>`}
    `}onInputChange(e){this.onDebouncedSearch(e.detail)}onCertifiedSwitchChange(e){e.detail?(this.badge="certified",Ie.showSvg("Only WalletConnect certified",{icon:"walletConnectBrown",iconColor:"accent-100"})):this.badge=void 0}qrButtonTemplate(){return _.isMobile()?c`
        <wui-icon-box
          size="xl"
          iconSize="xl"
          color="accent-primary"
          icon="qrCode"
          border
          borderColor="wui-accent-glass-010"
          @click=${this.onWalletConnectQr.bind(this)}
        ></wui-icon-box>
      `:null}onWalletConnectQr(){E.push("ConnectingWalletConnect")}};It([v()],Xe.prototype,"search",void 0);It([v()],Xe.prototype,"badge",void 0);Xe=It([T("w3m-all-wallets-view")],Xe);var Ki=function(t,e,n,o){var r=arguments.length,i=r<3?e:o===null?o=Object.getOwnPropertyDescriptor(e,n):o,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")i=Reflect.decorate(t,e,n,o);else for(var a=t.length-1;a>=0;a--)(s=t[a])&&(i=(r<3?s(i):r>3?s(e,n,i):s(e,n))||i);return r>3&&i&&Object.defineProperty(e,n,i),i};let jt=class extends I{constructor(){var e;super(...arguments),this.wallet=(e=E.state.data)==null?void 0:e.wallet}render(){if(!this.wallet)throw new Error("w3m-downloads-view");return c`
      <wui-flex gap="2" flexDirection="column" .padding=${["3","3","4","3"]}>
        ${this.chromeTemplate()} ${this.iosTemplate()} ${this.androidTemplate()}
        ${this.homepageTemplate()}
      </wui-flex>
    `}chromeTemplate(){var e;return(e=this.wallet)!=null&&e.chrome_store?c`<wui-list-item
      variant="icon"
      icon="chromeStore"
      iconVariant="square"
      @click=${this.onChromeStore.bind(this)}
      chevron
    >
      <wui-text variant="md-medium" color="primary">Chrome Extension</wui-text>
    </wui-list-item>`:null}iosTemplate(){var e;return(e=this.wallet)!=null&&e.app_store?c`<wui-list-item
      variant="icon"
      icon="appStore"
      iconVariant="square"
      @click=${this.onAppStore.bind(this)}
      chevron
    >
      <wui-text variant="md-medium" color="primary">iOS App</wui-text>
    </wui-list-item>`:null}androidTemplate(){var e;return(e=this.wallet)!=null&&e.play_store?c`<wui-list-item
      variant="icon"
      icon="playStore"
      iconVariant="square"
      @click=${this.onPlayStore.bind(this)}
      chevron
    >
      <wui-text variant="md-medium" color="primary">Android App</wui-text>
    </wui-list-item>`:null}homepageTemplate(){var e;return(e=this.wallet)!=null&&e.homepage?c`
      <wui-list-item
        variant="icon"
        icon="browser"
        iconVariant="square-blue"
        @click=${this.onHomePage.bind(this)}
        chevron
      >
        <wui-text variant="md-medium" color="primary">Website</wui-text>
      </wui-list-item>
    `:null}openStore(e){e.href&&this.wallet&&(D.sendEvent({type:"track",event:"GET_WALLET",properties:{name:this.wallet.name,walletRank:this.wallet.order,explorerId:this.wallet.id,type:e.type}}),_.openHref(e.href,"_blank"))}onChromeStore(){var e;(e=this.wallet)!=null&&e.chrome_store&&this.openStore({href:this.wallet.chrome_store,type:"chrome_store"})}onAppStore(){var e;(e=this.wallet)!=null&&e.app_store&&this.openStore({href:this.wallet.app_store,type:"app_store"})}onPlayStore(){var e;(e=this.wallet)!=null&&e.play_store&&this.openStore({href:this.wallet.play_store,type:"play_store"})}onHomePage(){var e;(e=this.wallet)!=null&&e.homepage&&this.openStore({href:this.wallet.homepage,type:"homepage"})}};jt=Ki([T("w3m-downloads-view")],jt);export{Xe as W3mAllWalletsView,Ke as W3mConnectingWcBasicView,jt as W3mDownloadsView};
