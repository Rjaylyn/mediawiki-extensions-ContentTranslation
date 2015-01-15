<?php
/**
 * Contains the special page Special:ContentTranslation.
 *
 * @file
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */

/**
 * Implements the core of the Content Translation extension:
 * a special page that shows Content Translation user interface.
 * @ingroup SpecialPage
 */
class SpecialContentTranslation extends SpecialPage {
	function __construct() {
		parent::__construct( 'ContentTranslation' );
	}

	public function getDescription() {
		return $this->msg( 'cx' )->text();
	}

	public function isListed() {
		return ContentTranslationHooks::isEnabledForUser( $this->getUser() );
	}

	public function execute( $parameters ) {
		$out = $this->getOutput();
		$skin = $this->getSkin();
		$request = $this->getRequest();

		$token = implode( '_', array(
			'cx',
			preg_replace( "/\s/", "-", urldecode( $request->getVal( 'page' ) ) ),
			$request->getVal( 'from' ),
			$request->getVal( 'to' ),
		) );

		// Direct access, isListed only affects Special:SpecialPages
		if ( !ContentTranslationHooks::isEnabledForUser( $this->getUser() ) &&
			// With a valid cx token or draft id, override beta feature settings.
			$request->getCookie( $token, '' ) === null &&
			$request->getVal( 'draft' ) === null
		) {
			$out->showErrorPage( 'nosuchspecialpage', 'nospecialpagetext' );
			return;
		}

		$out->addModuleStyles( 'mediawiki.ui.button' );
		if ( $request->getCookie( $token, '' ) === null &&
			$request->getVal( 'draft' ) === null
		) {
			$out->addModules( 'ext.cx.dashboard' );
		} else {
			$out->addModules( 'ext.cx.translationview' );
		}
		$this->setHeaders();
		$out->setArticleBodyOnly( true );

		// Default modules copied from OutputPage::addDefaultModules
		$out->addModules( array(
			'mediawiki.user',
			'mediawiki.page.startup',
			'mediawiki.page.ready',
		) );

		// Load legacy modules if any, for the skin.
		// Some wikis have Common.js scripts that depend on this module.
		$defaultSkinModules = $skin->getDefaultModules();
		$out->addModules( $defaultSkinModules['legacy'] );

		wfRunHooks( 'BeforePageDisplay', array( &$out, &$skin ) );

		$out->addHTML( $out->headElement( $skin ) );
		$out->addHTML( Html::element(
			'noscript',
			array(),
			$this->msg( 'cx-javascript' )->text()
		) );
		$out->addHtml( MWDebug::getDebugHTML( $this->getContext() ) );
		$toolbarList = Html::rawElement( 'ul',
			null,
			$skin->getPersonalToolsList() );
		$out->addHTML( Html::rawElement( 'div',
			array( 'id' => 'p-personal' ),
			$toolbarList ) );

		$out->addHTML( $skin->bottomScripts() );
		$out->addHTML( '</body></html>' );
	}
}
