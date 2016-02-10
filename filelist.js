/*
 * Copyright (c) 2014
 *
 * This file is licensed under the Affero General Public License version 3
 * or later.
 *
 * See the COPYING-README file.
 *
 */
(function() {
    var DELETED_REGEXP = new RegExp(/^(.+)\.d[0-9]+$/);
    /**
     * Convert a file name in the format filename.d12345 to the real file name.
     * This will use basename.
     * The name will not be changed if it has no ".d12345" suffix.
     * @param {String} name file name
     * @return {String} converted file name
     */
    function getDeletedFileName(name) {
        var match = DELETED_REGEXP.exec(name);
        if (match && match.length > 1) {
            name = match[1];
        }
        return name;
    }

    /**
     * @class OCA.Files.FileList
     * @classdesc
     *
     * The FileList class manages a file list view.
     * A file list view consists of a controls bar and
     * a file list table.
     *
     * @param $el container element with existing markup for the #controls
     * and a table
     * @param [options] map of options, see other parameters
     * @param [options.scrollContainer] scrollable container, defaults to $(window)
     * @param [options.dragOptions] drag options, disabled by default
     * @param [options.folderDropOptions] folder drop options, disabled by default
     */
    var FileList = function($el, options) {
        this.initialize($el, options);
    };
    /**
     * @memberof OCA.Files
     */
    FileList.prototype = {
        SORT_INDICATOR_ASC_CLASS: 'icon-triangle-n',
        SORT_INDICATOR_DESC_CLASS: 'icon-triangle-s',

        id: 'files',
        appName: t('files', 'Files'),
        isEmpty: true,
        useUndo:true,

        /**
         * Top-level container with controls and file list
         */
        $el: null,

        /**
         * Files table
         */
        $table: null,

        /**
         * List of rows (table tbody)
         */
        $fileList: null,

        /****/
        folderPreviews: null,
        /**
         * @type OCA.Files.BreadCrumb
         */
        breadcrumb: null,

        /**
         * @type OCA.Files.FileSummary
         */
        fileSummary: null,

        /**
         * Whether the file list was initialized already.
         * @type boolean
         */
        initialized: false,

        /**
         * Number of files per page
         *
         * @return {int} page size
         */
        pageSize: function() {
            return Math.ceil(this.$container.height() / 50);

            //this.pageSize() - this.$el.find('#fileList').height()/74,
        },

        /**
         * Array of files in the current folder.
         * The entries are of file data.
         *
         * @type Array.<Object>
         */
        files: [],
        currentFolder: {},
        getPhoto : decodeURIComponent(OC.Util.History.parseUrlQuery().photo),

        /**
         * File actions handler, defaults to OCA.Files.FileActions
         * @type OCA.Files.FileActions
         */
        fileActions: null,
        deletedFiles: [],
        deletedTypes: [],
        lastNewTag : '',
        rightSideSelectedTag:'',
        /**
         * Whether selection is allowed, checkboxes and selection overlay will
         * be rendered
         */
        _allowSelection: true,

        /**
         * Map of file id to file data
         * @type Object.<int, Object>
         */
        _selectedFiles: {},

        /**
         * Summary of selected files.
         * @type OCA.Files.FileSummary
         */
        _selectionSummary: null,

        /**
         * If not empty, only files containing this string will be shown
         * @type String
         */
        _filter: '',

        /**
         * Sort attribute
         * @type String
         */
        _sort: 'name',

        /**
         * Sort direction: 'asc' or 'desc'
         * @type String
         */
        _sortDirection: 'asc',

        /**
         * Sort comparator function for the current sort
         * @type Function
         */
        _sortComparator: null,

        /**
         * Whether to do a client side sort.
         * When false, clicking on a table header will call reload().
         * When true, clicking on a table header will simply resort the list.
         */
        _clientSideSort: false,

        /**
         * Current directory
         * @type String
         */
        _currentDirectory: null,

        _dragOptions: null,
        _folderDropOptions: null,
        view: null,
        /**
         * Initialize the file list and its components
         *
         * @param $el container element with existing markup for the #controls
         * and a table
         * @param options map of options, see other parameters
         * @param options.scrollContainer scrollable container, defaults to $(window)
         * @param options.dragOptions drag options, disabled by default
         * @param options.folderDropOptions folder drop options, disabled by default
         * @param options.scrollTo name of file to scroll to after the first load
         * @private
         */
        initialize: function($el, options) {
            var self = this;
            options = options || {};
            if (this.initialized) {
                return;
            }

            if (options.dragOptions) {
                this._dragOptions = options.dragOptions;
            }
            if (options.folderDropOptions) {
                this._folderDropOptions = options.folderDropOptions;
            }

            this.$el = $el;
            if (options.id) {
                this.id = options.id;
            }
            this.$container = options.scrollContainer || $(window);
            this.$table = $el.find('#filestable');
            this.$fileList = $el.find('#fileList');
            this._initFileActions(options.fileActions);
            this.files = [];
            this._selectedFiles = {};

            this._selectionSummary = new OCA.Files.FileSummary();
            this.fileSummary = this._createSummary();

            if($.cookie('sort') != undefined && $.cookie('sortDirection') != undefined){
                this.setSort($.cookie('sort'), $.cookie('sortDirection'));
            } else {
                this.setSort('mtime', 'asc');
            }

            //Need to save in cookie;
            if($.cookie('sort') == undefined) $.cookie('sort', 'mtime', { path: '/', expires: 7 });
            if($.cookie('sortDirection') == undefined) $.cookie('sortDirection', 'desc', { path: '/', expires: 7 });

            var breadcrumbOptions = {
                onClick: _.bind(this._onClickBreadCrumb, this),
                getCrumbUrl: function(part) {
                    //For sharing files
                    var currentUrlView = '';
                    var currenturl = OC.Util.History.parseUrlQuery();
                    if(currenturl.view == undefined){
                        if(currenturl == undefined || currenturl.view == undefined){
                            currentUrlView = ''
                        } else {
                            currentUrlView = currenturl.view;
                        }
                    } else {
                        currentUrlView = currenturl.view;
                    }

                    var viewShared = (currentUrlView == '') ? '' : '?view='+currentUrlView ;
                    var dirId = (part.dirId !== undefined) ? '&dirId=' + part.dirId : '';
                    if(viewShared !== ''){
                        return self.linkTo(part.dir).replace('?dir=', viewShared + dirId + '&dir=');
                    } else {
                        return self.linkTo(part.dir);
                    }

                }
            };
            // if dropping on folders is allowed, then also allow on breadcrumbs
            if (this._folderDropOptions) {
                breadcrumbOptions.onDrop = _.bind(this._onDropOnBreadCrumb, this);
            }
            this.breadcrumb = new OCA.Files.BreadCrumb(breadcrumbOptions);
            this.$el.find('#controls').prepend(this.breadcrumb.$el);
            this.$el.find('#controls').prepend('<img src="'+OC.filePath('core','img','disk-ico.png')+'" class="my-disk-ico">');

            this.$el.find('thead th .columntitle').click(_.bind(this._onClickHeader, this));
            var self = this;
            this.$el.find('.type-of-view input').on('change', function () {
                self.setSort($('.type-of-view input[name="sort"]:checked').data("sort"), $('.type-of-view input[name="direction"]:checked').data("direction"), true);
                //Need to save in cookie;
                $.cookie('sort', $('.type-of-view input[name="sort"]:checked').data("sort"), { path: '/', expires: 7 });
                $.cookie('sortDirection', $('.type-of-view input[name="direction"]:checked').data("direction"), { path: '/', expires: 7 });
            });

            this._onResize = _.debounce(_.bind(this._onResize, this), 100);
            $(window).resize(this._onResize);

            this.$el.on('show', this._onResize);


            this.updateSearch();

            //Load the Facebook JS SDK
            (function(d){
                var js, id = 'facebook-jssdk', ref = d.getElementsByTagName('script')[0];
                if (d.getElementById(id)) {return;}
                js = d.createElement('script'); js.id = id; js.async = true;
                js.src = "//connect.facebook.net/en_US/all.js";
                ref.parentNode.insertBefore(js, ref);
            }(document));
            // Init the SDK upon load
            window.fbAsyncInit = function() {
                FB.init({
                    appId      : '685266431602093', // App ID
                    status     : true, // check login status
                    cookie     : true, // enable cookies to allow the server to access the session
                    xfbml      : true  // parse XFBML
                });
            };

            $('body').on('click','span#facebook', _.bind(this._fbSend, this));
            $('body').on('click','span#vkontakte', _.bind(this._vkSend, this));
            $('body').on('click','span#mail', _.bind(this._mailSend, this));
            $('body').on('click','span#twitter', _.bind(this._twttrSend, this));
            $('body').on('click','span#ok', _.bind(this._okSend, this));
            $('body').on('click','span#g-plus', _.bind(this._gSend, this));

            this.$el.on('click', '.control-properties', _.bind(this._fullInfoAnimation, this));
            this.$fileList.on('dblclick', 'li', _.bind(this._onDblClickFile , this));
            $('#fileList').on('click', 'li', _.bind(this._onClickFile, this));
            this.$fileList.on('change', 'div.filename>.selectCheckBox', _.bind(this._onClickFileCheckbox, this));
            this.$el.on('urlChanged', _.bind(this._onUrlChanged, this));
            //this.$el.find('.select-all').click(_.bind(this._onClickSelectAll, this));
            $('body').on('click', 'delete-selectedload', _.bind(this._onClickDownloadSelected, this));
            $('body').on('click', '.share-settings, .context-share', _.bind(this._onClickShareSelected, this));
            //$('body').on('click', '.share-settings, .context-share', _.bind(OC.Share.renderSharingMenu, this));
            $('body').on('click' , '.print' ,_.bind(this._onClickPrintSelected, this));

            this.$el.find('.delete-selected').click(_.bind(this._onClickDeleteSelected, this));
            $('body').on('click', '#undelete-notifications', _.bind(this._onClickUndelete, this));
            this.$el.find('.context-rename').click(_.bind(this._contextRenameFolder, this));
//                              BEGIN OF OF EXPLORER CONTEXT
            this.$el.on('click', '.show-context', _.bind(this._showContextMenu, this));
            $('body').on('click', '.create-folder', _.bind(this._mainContextCreateFolder, this));
            $('body').on('click', '.list-of-popular-tags span', _.bind(this._searchByTag, this));
            $('body').on('click', '.file-tagname', _.bind(this._searchByTagOnRight, this));

//                              END OF EXPLORER CONTEXT
            $('body').on('click', '.get-child-tree', _.bind(this._getChildTree, this));
            $('body').on('click', '.treeFolderItem', _.bind(this._selectTreeFolderItem, this));
            $('body').on('click', '.files-tree-wrapper .trashbin', _.bind(this._getTrashbin, this));
            $('body').on('click', '.tree-context-download', _.bind(this._treeContextDownload, this));
//                              BEGIN OF MAIN CONTEXT MENU
//            $('#content-files #fileList').on('mousedown', _.bind(this._showMainContextOnRightClick, this));
            //this.$el.on('mousedown', _.bind(this._showMainContextOnRightClick, this));
            this.$el.find('#fileList').on('mousedown', _.bind(this._showMainContextOnRightClick, this));
            this.$el.on('click', '.main-context-create', _.bind(this._mainContextCreateFolder, this));
            this.$el.on('click', '.main-context-rename', _.bind(this._mainContextRename, this));
            this.$el.on('click', '.main-context-delete, .delete-selected', _.bind(this._mainContextDelete, this));
            this.$el.on('click', '.main-context-move, .move', _.bind(this._mainContextMove, this));
            this.$el.on('click', '.main-context-copy, .copy', _.bind(this._mainContextCopy, this));
            this.$el.on('click', '.main-context-download', _.bind(this._mainContextDownload, this));
            //this.$el.on('click', '.download', _.bind(this._mainContextDownload, this));
            this.$el.on('click', '.download', _.bind(this._onClickDownloadSelected, this));

//                             END OF MAIN CONTEXT MENU
            $("body").on("click", ".shared-to-user .unshare",  _.bind(this._unsharePermissons, this));
            $("body").on("click", ".shared-to-user .return-share",  _.bind(this._returnSharePermissons, this));
            $("body").on("click", ".shared-by-link .unshare",  _.bind(this._unsharePublicPermissons, this));
            $("body").on("click", ".shared-by-link .return-share",  _.bind(this._returnPublicSharePermissons, this));
            $("body").on("click", ".new-public-share", _.bind(this._createPublicShareLink, this));
            $("body").on("click", ".new-private-share", _.bind(this._createPrivateShareLink, this));
            $("body").on("click", ".tab-public a", _.bind(this._showPublicShare, this));
            $("body").on("click", ".tab-private a", _.bind(this._showPrivateShare, this));
            $("body").on("click", ".oc-dialog-close", _.bind(this._closeDialog, this));
            $('body').on('mousedown', '.file-tagname', _.bind(this._showTagOptions, this));
            $('body').on('click', '.file-tag-edit', _.bind(this._renameTagPopup, this));
            $('body').on('keyup', '#searchbox', _.bind(this.runSearch, this));
            $('body').on('click', '.search-button', _.bind(this.showResults, this));

            //$(document).on('scroll', _.bind(this._onScroll, this));
            $('body').on('click', '.showMore', _.bind(this._onClickNext, this));
            $('body').on('click', '.sharing-span-list', _.bind(this._showShareMenu, this));
            $('body').on('click', '.sharing-span-list-share', _.bind(this._showShareMenuShare, this));

            if (options.scrollTo) {
                this.$fileList.one('updated', function() {
                    self.scrollTo(options.scrollTo);
                });
            }

            $("body").on('click', function () {
                if($('.type-of-view').css('display') == 'block')  {
                    if($(window).width() < 768) {
                        $('.type-of-view').slideToggle();
                    } else {
                        $('.type-of-view').fadeToggle();
                    }
                }
            });

            $(".file-tags").on('click', '.action-renameTag', function () {
                elem = $(this).parent()[0];
                id = $('.fullinfo').find('.name').data('id');
                tag = elem.dataset.tag;
                tags = $('.fullinfo .file-tags').data('tags').split(',');
                popupShow(t('files', 'rename'), '<input type="text" class="renameTagInput" value="' + tag + '"/>', '<div class="button">' + t('files', 'Ok') + '</div>');
                $('body').on('click', '.button', function () {
                    newTag = $('body').find('.renameTagInput').val();
                    tags = _.without(tags, tag);
                    tags = tags.concat(newTag);
                    $('.fullinfo .file-tags').data('tags', tags.toString());
                    OC.Tags.Client.applyTags({name: $('.fullinfo').find('.name').find('span').text(), tags: tags}, self, tags);
                    $(elem).find('.tag-value').text(newTag);
                    $(elem).attr('data-tag', newTag);
                    popupHide();
                });

            });

            $('body').on('click', '.action-delTag', function () {
                var elem = $(this).parent()[0];
                var id = $('.fullinfo').find('.name').data('id');
                var tag = elem.dataset.tag;


                var tags = ($('.fullinfo .file-tags').data('tags').toString().indexOf(',') !== -1) ? $('.fullinfo .file-tags').data('tags').split(',') : [$('.fullinfo .file-tags').data('tags')];
                tags = _.without(tags, ""+tag);
                $('.fullinfo .file-tags').data('tags', tags.toString());

                popupShow(t('files', 'Вы уверены?'), '',
                    '<div data-action="ok" class="button delete-button"> ' +
                    t('files', 'Delete') +
                    '</div>' +
                    '<div data-action="cancel" class="button cancel-button popup-ok">' +
                    t('files', 'Cancel') +
                    '</div>');
                $('body').find('#popup').one('click', '.delete-button', function () {
                    var curentSelectedFile = self._selectedFiles;
                    if  ($.isEmptyObject(curentSelectedFile) == true){

                        var name = "";
                            OC.Tags.Client.applyTags({name: name, tags: tags}, self, tags);

                            var file = self.currentFolder;
                            var tag =  elem.dataset.tag;
                            file.tags = _.without(file.tags, ""+tag);

                    }else{
                        for (var key in self._selectedFiles){
                            var name = self._selectedFiles[key].name;
                            OC.Tags.Client.applyTags({name: name, tags: tags}, self, tags);

                            var file = _.find(self.files, function(num){return num.id==key });
                            var tag =  elem.dataset.tag;
                            file.tags = _.without(file.tags, ""+tag);
                        }
                    }


                    //OC.Tags.Client.applyTags({name: '', tags: tags}, self, tags);
                    $(elem).remove();
                    $('.fullinfo .file-tags').data('tags', tags.join());
                    $('.fullinfo .file-tags').data('tags', tags.join());
                    popupHide();
                });
                $('body').find('#popup').one('click', '.cancel-button', function () {
                    popupHide();
                });
            });
            $('body').on('click', '.addNewTag, #addNewTagMobile', _.bind(this._addNewTag,this));
            $('.under-search-tags').on('click', '.more-tags', function(e){
                $('.under-search-tags').toggleClass('other-tags');
                e.stopPropagation();
                //$('.under-search-tags').removeClass('other-tags');

            });

            OC.Plugins.attach('OCA.Files.FileList', this);
        },
        /**
         * Destroy / uninitialize this instance.
         */
        destroy: function () {
            // TODO: also unregister other event handlers
            this.fileActions.off('registerAction', this._onFileActionsUpdated);
            this.fileActions.off('setDefault', this._onFileActionsUpdated);
            OC.Plugins.detach('OCA.Files.FileList', this);
        },
        /**
         * Initializes the file actions, set up listeners.
         *
         * @param {OCA.Files.FileActions} fileActions file actions
         */
        _initFileActions: function (fileActions) {
            this.fileActions = fileActions;
            if (!this.fileActions) {
                this.fileActions = new OCA.Files.FileActions();
                this.fileActions.registerDefaultActions();
            }
            this._onFileActionsUpdated = _.debounce(_.bind(this._onFileActionsUpdated, this), 100);
            this.fileActions.on('registerAction', this._onFileActionsUpdated);
            this.fileActions.on('setDefault', this._onFileActionsUpdated);
        },
        /**
         * Event handler for when the window size changed
         */
        _onResize: function () {
            var containerWidth = this.$el.width();
            var actionsWidth = 0;
            $.each(this.$el.find('#controls .actions'), function (index, action) {
                actionsWidth += $(action).outerWidth();
            });
            this._adaptationTexts();

            // substract app navigation toggle when visible
            containerWidth -= $('#app-navigation-toggle').width();

            this.breadcrumb.setMaxWidth(containerWidth - actionsWidth - 10);

            this.updateSearch();
        },
        /**
         * Event handler for when the URL changed
         */
        _onUrlChanged: function (e) {
            if (e && e.dir) {
                this.changeDirectory(e.dir, false, true, e.dirId);
            }
        },
        /**
         * Selected/deselects the given file element and updated
         * the internal selection cache.
         *
         * @param $tr single file row element
         * @param state true to select, false to deselect
         */
        _selectFileEl: function ($tr, state) {
            var $checkbox = $tr.find('div.filename>.selectCheckBox');
            var oldData = !!this._selectedFiles[$tr.data('id')];
            var data;
            $checkbox.prop('checked', state);
            $tr.toggleClass('selected', state);
            // already selected ?
            if (state === oldData) {
                return;
            }
            data = this.elementToFile($tr);
            if (state) {
                this._selectedFiles[$tr.data('id')] = data;
                this._selectionSummary.add(data);
            } else {
                delete this._selectedFiles[$tr.data('id')];
                this._selectionSummary.remove(data);
            }
            this.$el.find('.select-all').prop('checked', this._selectionSummary.getTotal() === this.files.length);
        },
        _addNewTag: function(){
            var files = this.getSelectedFiles();
            var tag = this.lastNewTag;
            var self = this;
            if(!$('body').hasClass('mobile-fullinfo-opened')){
                popupShow(
                    t('files', 'Adding new tag'),
                    '<label for="newTagInput">' + t("files", "Add new tag") +
                    '<span class="msg error">' + t("settings", "This tag already exists") + '</span>' +
                    '</label>' +
                    '<input type="text" id="newTagInput" class="newTagInput"  value="'+self.lastNewTag+'" autofocus/>',
                    '<div id="addNewTag" class="button button-ok">' + t('files', 'Ok') + '</div>',
                    'addNewTagPopup'
                );
            }
            $('body').off('click', '#addNewTag, #addNewTagMobile');
            $('body').on('click', '#addNewTag, #addNewTagMobile', function () {
                if($('body').find('#newTagInput').val().length > 2) {
                    self.lastNewTag = $('body').find('#newTagInput').val();

                } else {
                    self.lastNewTag = '';
                    if(!$('body').hasClass('mobile-fullinfo-opened')){
                        $('#newTagInput').parents('.popup-content').find('label .msg').text(t('files','Length of tags must be more than 2 symbols')).fadeIn();
                        //popupHide();
                    }
                    return;
                }
                //Many files
                if(files.length > 1){
                    var tags = [];
                    var filterFiles  = _.filter(self.files, function(obj){return _.pluck(files, 'id').indexOf(parseInt(obj.id)) != -1})
                    filterFiles.forEach(function(obj){
                        if(obj.tags.length != 0) {
                            tags = tags.concat(obj.tags);
                        }
                    })
                    if(tags.indexOf(self.lastNewTag) != -1){

                        var title = $(t('files', 'Добавление нового тега')),
                            txt = $('<p class="existTagText">'+t('files', 'Такой тег существует. Вы хотите совместить этот тег?')+'</p>'),
                            bttnNo = $('<div class="button merge-cancel cancel-button">'+t('files', 'Нет')+'</div>'),
                            bttnYes = $('<div class="button merge-ok button-ok">'+t('files', 'Да')+'</div>');
                        $('#newTagInput, label[for="newTagInput"], #addNewTag').hide();
                        $('#popup .popup-heading').append(title);
                        $('#popup .popup-content').append(txt);
                        $('#popup .popup-buttons').append([bttnYes,bttnNo]);
                        //Button Yes
                        $('.merge-ok').on('click', function(){
                            var tags = [];
                            _.each(files, function(data){
                                var current = _.findWhere(self.files, {'id':''+data.id});
                                tags = _.uniq(current.tags.concat(self.lastNewTag));
                                current.tags = tags;
                                response = OC.Tags.Client.applyTags({name: data.name, tags: tags}, self, tags);
                            });
                            if(response.status == 404){
                                $('#newTagInput').parents('.popup-content').find('label .msg').text(response.responseJSON).fadeIn();
                                return;
                            } else if(response.status == 200){
                                $('.fullinfo').find('.file-tags').attr('data-tags', tags.join());
                                var tagWrp = $('<span class="file-tag" data-tag="'+tag+'">' + '</span>');
                                tagWrp.insertBefore('.file-tags .blockContainer .add-tag-wrp');
                                self.lastNewTag = '';
                                popupHide();
                                return;
                                popupHide();
                                self.rightSideSelectedTag = '';
                            }
                        });
                        $('.merge-cancel').on('click', function(){
                            popupHide();
                            self.rightSideSelectedTag = '';
                            self.lastNewTag = '';
                        });
                        $('body').find('#popup').one('click', '.popup-close', function(){
                            self.rightSideSelectedTag = '';
                            self.lastNewTag = '';
                        });
                        $('body').one('click', '#popup-bgd', function(){
                            self.rightSideSelectedTag = '';
                            self.lastNewTag = '';
                        });
                    } else {
                        var tags = [];
                        var n=0;
                        for(var i=0;i<files.length;i++){
                            var data = files[i];
                            var current = _.findWhere(self.files, {'id':''+data.id});
                            tags = _.uniq(current.tags.concat(self.lastNewTag));
                            //current.tags = tags;
                            response = OC.Tags.Client.applyTags({name: data.name, tags: tags}, self, tags);
                            if(response.status == 404){
                                $('#newTagInput').parents('.popup-content').find('label .msg').text(response.responseJSON).fadeIn();
                                break;
                            } else if(response.status == 200) {
                                current.tags = tags;
                                if(n == 0) {
                                    $('.fullinfo').find('.file-tags').attr('data-tags', tags.join());
                                    var tagWrp = $('<span class="file-tag" data-tag="' + tag + '">' +
                                        '<span class="file-tagname">' + self.lastNewTag + '</span>' +
                                        '<span class="action-delTag" data-action="delTag"></span>' +
                                        '</span>');
                                    tagWrp.insertBefore('.file-tags .blockContainer .add-tag-wrp');
                                    popupHide();
                                    n++;
                                }
                            }
                        };
                        self.lastNewTag = '';
                    }
                    return;
                }
                //one file
                var id = $('.fullinfo').find('.name').data('id');
                var tags = ($('.fullinfo').find('.file-tags').data('tags')) ?
                    String($('.fullinfo').find('.file-tags').data('tags')).split(',') :
                    '';
                tag = self.lastNewTag;
                if (tags.indexOf(tag) === -1) {
                    if (tags.length) {
                        var allTags = tags.concat([tag]);
                    } else {
                        var allTags = [tag];
                    }
                    var thisModelTags = [],
                        response = {};

                    if(files.length === 0) {
                        thisModelTags = tags;
                        response = OC.Tags.Client.applyTags({name: '', tags: tags}, self, allTags);
                    } else {
                        response = OC.Tags.Client.applyTags({name: ($('.fullinfo').find('.file-name').text())?$('.fullinfo')
                            .find('.file-name').text():'', tags: tags}, self, allTags);
                        thisModelTags = _.first(_.where(self.files.concat(OC.Search.lastResults), {id: ''+self.getSelectedFiles()[0].id})).tags;
                    }

                    if(response.status == 404){
                        $('#newTagInput').parents('.popup-content').find('label .msg').text(response.responseJSON).fadeIn();
                        return;
                    } else if(response.status == 200){
                        var curentSelectedFile = self._selectedFiles;
                        if  ($.isEmptyObject(curentSelectedFile) == true){
                            self.currentFolder.tags = allTags;
                        }else{
                            var current = _.findWhere(self.files, {'id':''+ _.pluck(files, 'id')});
                            tags = _.uniq(current.tags.concat(self.lastNewTag));
                            current.tags = tags;
                        }

                        $('.fullinfo').find('.file-tags').data('tags', allTags.join());
                        if(thisModelTags.length == 0) thisModelTags = [];
                        thisModelTags.push(tag);
                        console.log(tag.length);


                        var tagWrp = $('<span class="file-tag" data-tag="'+tag+'">' +
                            '<span class="file-tagname">'+tag+'</span>' +
                            '<span class="action-delTag" data-action="delTag"></span>'+
                            '</span>');
                        if(tag.length == 26){alert('jhk'); $('.blockContainer > .file-tag[data-tag='+tag+']').css('background', 'red');}
                        if(!$('body').hasClass('mobile-fullinfo-opened')){
                            tagWrp.insertBefore('.file-tags .blockContainer .add-tag-wrp');
                            popupHide();
                        } else {
                            tagWrp.insertBefore('.file-tags .blockContainer .add-tag-wrp');
                            tagWrp.clone().insertAfter('.fullinfo-tabs .fullinfo-tab-content .fullinfo-addTag-mobile');
                        }
                        self.lastNewTag = '';
                    }

                } else {
                    $('.fullinfo .file-tags').data('tags', tags.join());
                    var txt = $('<p class="existTagText">'+t('files', 'Такой тег существует. Вы хотите совместить этот тег?')+'</p>'),
                        btnNo = $('<div class="button merge-cancel cancel-button">'+t('files', 'Нет')+'</div>'),
                        btnYes = $('<div class="button merge-ok button-ok">'+t('files', 'Да')+'</div>');

                    $('.addNewTagPopup #newTagInput, .addNewTagPopup label[for="newTagInput"], .addNewTagPopup #addNewTag').hide();
                    $('.fullinfo-addTag-mobile #newTagInput').val('');

                    $('#popup .popup-content').append(txt);
                    $('#popup .popup-buttons').append([btnYes,btnNo]);
                    $('.merge-cancel, .merge-ok').on('click', function(){
                        popupHide();
                        self.lastNewTag = '';
                    });
                    $('body').find('.addNewTagPopup').one('click', '.popup-close', function(){
                        self.lastNewTag = '';
                    });
                    $('body').one('click', '#popup-bgd', function(){
                        self.lastNewTag = '';
                    });
                }
            });
        },
        _showTagOptions: function(event){
            this.rightSideSelectedTag = ''+$(event.currentTarget).parents('.file-tag').data('tag');

            $('.file-tag-edit').fadeOut(200, function(){
                $(this).remove();
            });
            var tagEdit = $('<div class="file-tag-edit">'+t('files', 'Edit title')+'</div>'),
                tagEditBefore = $('<div class="file-tag-edit-before"></div>');
            tagEdit.prepend(tagEditBefore);
            $('body').append(tagEdit);
            switch (event.which) {
                case 3:
                    tagEdit.css({
                        'top': event.pageY+20+"px",
                        'left': event.screenX-140+ "px"
                    });
                    tagEditBefore.css({
                        'left': ((tagEdit.outerWidth())/2)+(tagEditBefore.width()/2)+ "px"
                    });
                    tagEdit.fadeIn();
                    break;
                default:
                    $('.file-tag-edit').fadeOut();
            }
            event.stopPropagation();
            $('body').click(function(){
                tagEdit.fadeOut(200, function(){
                    $(this).remove();
                })
            });
        },
        _renameTagPopup: function () {
            var self = this;
            var files = self.getSelectedFiles();
            var tag = self.rightSideSelectedTag;
            popupShow(t('files', 'Renaming'),
                '<label for="renameTagInput">'+t('files', 'Enter the new tag name')+'<span class="msg error"></span></label>' +
                '<input type="text" id="renameTagInput"  value="' + tag + '" autofocus/>',
                '<div id="renameButton" class="button button-ok">' + t('files', 'Ok') + '</div>',
                'renameTagPopup'
            );
            $('body').off('click', '#renameButton');
            $('body').on('click', '#renameButton', function () {
                if($('body').find('#renameTagInput').val().length > 2) {
                    var newTag = $('body').find('#renameTagInput').val();
                } else {
                    var newTag = '';
                    if(!$('body').hasClass('mobile-fullinfo-opened')){
                        $('#renameTagInput').parents('.popup-content').find('label .msg').text(t('files','Length of tags must be more than 2 symbols')).fadeIn();
                        //popupHide();
                    }
                    return;
                }
                var id = $('.file-preview-name').data('id');
                var tags = $('.fullinfo').find('.file-tags').data('tags').split(',');
                //var tags = current.tags;
                //var newTag = $('body').find('#renameTagInput').val();
                if (files.length > 1) {
                    _.each(files, function (data) {
                        var current = _.findWhere(self.files, {'id': '' + data.id});
                        if (current.tags.indexOf(tag) !== -1) {
                            current.tags = _.without(current.tags, tag);
                            current.tags = _.uniq(current.tags.concat(newTag));
                            OC.Tags.Client.applyTags({name: data.name, tags: current.tags}, self, current.tags);
                        }
                    })
                    popupHide();
                    $('.fullinfo').find('.file-tags').attr('data-tags', _.without(tags, tag).concat(newTag).join());
                    $('body').find('.file-tag[data-tag="' + tag + '"]').remove(); //

                    var tagWrp = $('<span class="file-tag" data-tag="' + newTag + '">' +
                        '<span class="file-tagname">' + newTag + '</span>' +
                        '<span class="action-delTag" data-action="delTag"></span>' +
                        '</span>');
                    tagWrp.insertBefore('.file-tags .blockContainer .add-tag-wrp');
                    return;
                }
                if (tags.indexOf(newTag) === -1) { // check on New
                    tags = _.without(tags, tag);   // without main
                    tags = tags.concat(newTag);  // add new to all tags without main
                    self.rightSideSelectedTag = '';
                    $('.fullinfo .file-tags').attr('data-tags', tags.join()); // add tags to dom
                    var curentSelectedFile = self._selectedFiles;
                    if  ($.isEmptyObject(curentSelectedFile) == true){
                        response = OC.Tags.Client.applyTags({  //
                            name: '',
                            tags: tags
                        }, self, tags);
                    }else{
                        response = OC.Tags.Client.applyTags({  //
                            name: ($('.fullinfo').find('.file-name').text()) ? $('.fullinfo').find('.file-name').text() : '',
                            tags: tags
                        }, self, tags);
                    }
                    if(response.status == 404){
                        $('#renameTagInput').parents('.popup-content').find('label .msg').text(response.responseJSON).fadeIn();
                        return;
                    } else if(response.status == 200) {
                        $('body').find('.file-tag[data-tag="'+tag+'"]').remove(); //

                        if  ($.isEmptyObject(curentSelectedFile) == true){
                            self.currentFolder.tags = tags;
                        }else{
                            var current = _.findWhere(self.files, {'id':''+ _.pluck(files, 'id')});
                            current.tags = tags;
                        }

                        $('.fullinfo').find('.file-tags').data('tags', tags.join(','));
                        self.rightSideSelectedTag = '';
                        var tagWrp = $('<span class="file-tag" data-tag="'+newTag+'">' +
                            '<span class="file-tagname">'+newTag+'</span>' +
                            '<span class="action-delTag" data-action="delTag"></span>'+
                            '</span>');
                        tagWrp.insertBefore('.file-tags .blockContainer .add-tag-wrp');
                        popupHide();
                    }
                } else {
                    tags = _.without(tags, tag);
                    $('.fullinfo .file-tags').data('tags', tags.join());
                    var txt = $('<p class="existTagText">'+t('files', 'This tag already exists. What would capture the tags, click OK')+'</p>'),
                        btnNo = $('<div class="button merge-cancel cancel-button">'+t('files', 'No')+'</div>'),
                        btnYes = $('<div class="button merge-ok button-ok">'+t('files', 'Yes')+'</div>');

                    $('#renameTagInput, label[for="renameTagInput"], #renameButton').hide();

                    $('#popup .popup-content').append(txt);
                    $('#popup .popup-buttons').append([btnYes,btnNo]);

                    $('.merge-ok').on('click', function(){

                        //$('.file-tags').find('.file-tag[data-tag="'+tag+'"]').remove();
                        popupHide();
                        self.rightSideSelectedTag = '';
                    });

                    $('.merge-cancel').on('click', function(){
                        popupHide();
                        self.rightSideSelectedTag = '';
                        self.lastNewTag = '';
                    });
                    $('body').find('.addNewTagPopup').one('click', '.popup-close', function(){
                        self.rightSideSelectedTag = '';
                        self.lastNewTag = '';
                    });
                    $('body').one('click', '#popup-bgd', function(){
                        self.rightSideSelectedTag = '';
                        self.lastNewTag = '';
                    });
                }
            });
        },
        _closeSortTab: function(){
            if($('.type-of-view').css('display') == 'block')  {
                if($(window).width() < 768) {
                    $('.type-of-view').slideToggle();
                } else {
                    $('.type-of-view').fadeToggle();
                }
            }
        },
        /**
         * Event handler for when clicking on files to select them
         */
        _onClickFile: function (event) {
            var self = this;
            var $tr = $(event.target).closest('li');
            // if it mobile device don't select file
            if($tr.data('mounttype') !== 'trashbin' && (('ontouchstart' in window)
                || (navigator.MaxTouchPoints > 0)
                || (navigator.msMaxTouchPoints > 0))){
                this._onDblClickFile(event);

            } else {
                $('.file-action-nav-right .actions-unselected').hide();
                $('.file-action-nav-right .actions-selected').show();

                var $checkbox = $tr.find('div.filename>.selectCheckBox');
                if (event.ctrlKey|| event.metaKey || event.shiftKey) {
                    event.preventDefault();
                    if (event.shiftKey) {
                        var $lastTr = $(this._lastChecked);
                        var lastIndex = $lastTr.index();
                        var currentIndex = $tr.index();
                        var $rows = this.$fileList.children('li');

                        // last clicked checkbox below current one ?
                        if (lastIndex > currentIndex) {
                            var aux = lastIndex;
                            lastIndex = currentIndex;
                            currentIndex = aux;
                        }

                        // auto-select everything in-between
                        for (var i = lastIndex + 1; i < currentIndex; i++) {
                            this._selectFileEl($rows.eq(i), true);
                        }
                    }
                    else {
                        this._lastChecked = $tr;
                    }
                    this._selectFileEl($tr, !$checkbox.prop('checked'));
                    this.updateSelectionSummary();
                    event.stopPropagation();
                    $('body').on('click', function(event){
                        self.onClickRemoveSelection(event);
                    });
                } else {
                    event.preventDefault();
                    this._closeSortTab();
                    $('#fileList li').removeClass('selected');
                    $('#fileList li div.filename>.selectCheckBox').prop('checked', false);
                    this._selectedFiles = {};
                    this._selectionSummary.clear();
                    this._selectFileEl($tr, !$checkbox.prop('checked'));
                    this._lastChecked = $tr;
                    this.updateSelectionSummary();
                    event.stopPropagation();
                    $('body').on('click', function(event){
                        self.onClickRemoveSelection(event);
                    });
                }
            }
            setTimeout(function(){ self._controlProperties(); }, 200);
        },
        onClickRemoveSelection: function(event){
            var self = this;
            if(!$(event.target).closest('#controls').length
                && !$(event.target).closest('#fileList').length
                && !$(event.target).closest('#fullInfo .fullinfo').length
                && !$(event.target).closest('#popup').length
                && !$(event.target).closest('#popup-bgd').length
                && !$(event.target).closest('.main-context').length
                && !$(event.target).closest('.sharingMenu').length
                && !$(event.target).closest('.file-tag-edit').length
                && !$(event.target).closest('.file-action-nav-right > div > div').length){
                self.removeSelection();
            }
        },
        removeSelection: function(){
            var self = this;
            if(self.getSelectedFiles().length){
                if($('.actions-unselected').is(":visible")) {
                    $('.actions-selected').hide()
                } else {
                    $('.actions-selected').hide();
                    $('.actions-unselected').show();
                }
                $('#fileList li').removeClass('selected');
                $('#fileList li div.filename>.selectCheckBox').prop('checked', false);
                self._selectedFiles = {};
                self._controlProperties();
                self.updateSelectionSummary();
            }
        },
        _openImage: function () {
            var file = _.findWhere(this.files, {name: this.getPhoto});
            if (file) {
                var action = this.fileActions.getDefault(file.mimetype, file.type, file.permissions);
                if (action) {
                    event.preventDefault();
                    window.FileActions.currentFile = this.fileActions.currentFile;
                    action(file.name, {
                        $file: file,
                        fileList: this,
                        fileActions: this.fileActions,
                        dir: file.path || this.getCurrentDirectory()
                    });
                }
            } else {
                url = OC.Util.History.parseUrlQuery();
                delete url.photo;
                OC.Util.History.pushState(url);
            }
        },
        _onDblClickFile: function(event){
            var self = this;
            var $tr = $(event.target).closest('li'),
                filename = $tr.attr('data-file'),
                datatype = $tr.attr('data-type'),
                datamounttype = $tr.attr('data-mounttype'),
                renaming = $tr.data('renaming');
            if( $tr.attr('data-isshare') == "true"){
                this.isShare = true;
                self.isShare = true;
            }

            if (datatype != 'dir'){
                var dir = this.getCurrentDirectory();
                if(datamounttype == 'shared-root') OC.redirect(OC.generateUrl("/apps/file_view/?view=shared&dir=" + dir + "&name=" + filename));
                else if(datamounttype == 'trashbin') {
                    OC.dialogs.alert("You need restore file.", t('files_trashbin', 'Error'));
                }
                else OC.redirect(OC.generateUrl("/apps/file_view/?dir=" + dir + "&name=" + filename));
                return;
            }
            if (!renaming) {
                this.fileActions.currentFile = $tr.find('div');
                var mime = this.fileActions.getCurrentMimeType();
                var type = this.fileActions.getCurrentType();
                var permissions = this.fileActions.getCurrentPermissions();
                var action = this.fileActions.getDefault(mime, type, permissions);
                if (action) {
                    event.preventDefault();
                    // also set on global object for legacy apps
                    window.FileActions.currentFile = this.fileActions.currentFile;
                    action(filename, {
                        $file: $tr,
                        fileList: this,
                        fileActions: this.fileActions,
                        dir: $tr.attr('data-path') || this.getCurrentDirectory()
                    });
                }
                // deselect row
                $(event.target).closest('a').blur();
            }
        },
        /**
         * Event handler for when clicking on a file's checkbox
         */
        _onClickFileCheckbox: function (e) {
            $tr = $(e.target).closest('li');
            this._selectFileEl($tr, !$tr.hasClass('selected'));
            this._lastChecked = $tr;
            this.updateSelectionSummary();
        },
        /**
         * Event handler for when selecting/deselecting all files
         */
        _onClickSelectAll: function (e) {
            //          OC.dialogs.filepicker
            var checked = $(e.target).prop('checked');
            this.$fileList.find('div.filename>.selectCheckBox').prop('checked', checked)
                .closest('li').toggleClass('selected', checked);
            this._selectedFiles = {};
            this._selectionSummary.clear();
            if (checked) {
                for (var i = 0; i < this.files.length; i++) {
                    var fileData = this.files[i];
                    this._selectedFiles[fileData.id] = fileData;
                    this._selectionSummary.add(fileData);
                }
            }
            this.updateSelectionSummary();
        },
        /**
         * Event handler for when clicking on "Download" for the selected files
         */
        _onClickDownloadSelected: function (event) {
            console.log('download is start');
            $('.under-logo-notifications').find('.loading-page').text(t('files','LoadingDownload')+"...").prepend('<img class="loading-ico" src="'+OC.imagePath('core', 'loading-ico.png')+'">');
            function removeAnimateDownload(){
                $('.under-logo-notifications').find('.loading-page').text('');
            }
            var files;
            var dir = this.getCurrentDirectory();
            if (this.isAllSelected()) {
                files = OC.basename(dir);
                dir = OC.dirname(dir) || '/';
            }
            else {
                files = _.pluck(this.getSelectedFiles(), 'name');

                //generate array of file object
                allFiles = this.files.concat(OC.Search.lastResults);
                var selFiles = this.getSelectedFiles();
                files0 = _.filter(allFiles, function(el){return _.pluck(selFiles, 'id').indexOf(parseFloat(el.id)) != -1})
                var files = _.map(files0, function(el){
                        return { dir: OC.dirname(el.fullPath) || '/', name: el.name };
                    }
                );

                if(files.length === 0){
                    files = '';
                }
            }

            /*$.ajax({
             url: this.getDownloadUrl(files, dir),
             success: function(result) {
             console.log('download is end');

             }
             });*/



            /*if (!XMLHttpRequest.prototype.sendAsBinary) {
             XMLHttpRequest.prototype.sendAsBinary = function (sData) {
             var nBytes = sData.length, ui8Data = new Uint8Array(nBytes);
             for (var nIdx = 0; nIdx < nBytes; nIdx++) {
             ui8Data[nIdx] = sData.charCodeAt(nIdx) & 0xff;
             }
             /!* send as ArrayBufferView...: *!/
             this.send(ui8Data);
             /!* ...or as ArrayBuffer (legacy)...: this.send(ui8Data.buffer); *!/
             };
             }

             var xmlhttp = new XMLHttpRequest();
             xmlhttp.onreadystatechange = function() {
             if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {
             //console.log(xmlhttp.status);
             //console.log(xmlhttp.readyState);
             console.log('Загрузка пошла');
             }
             };


             xmlhttp.open("GET", this.getDownloadUrl(files, dir), true);

             var response = '';
             xmlhttp.onload = function () {
             if (this.status === 200) {
             var type = xmlhttp.getResponseHeader('Content-Type');
             console.log(type);

             /!*var nBytes = this.response.length, ui8Data = new Uint8Array(nBytes);
             for (var nIdx = 0; nIdx < nBytes; nIdx++) {
             ui8Data[nIdx] = this.response.charCodeAt(nIdx) & 0xff;
             }*!/

             /!* var byteArray = new Uint8Array(this.response.length/2);
             for (var x = 0; x < byteArray.length; x++){
             byteArray[x] = parseInt(this.response.substr(x*2,2), 16);
             }*!/

             var blob = new Blob([this.response], { type: 'application/octet-stream' });
             var url = URL.createObjectURL(blob);
             console.log('create ' + url);
             console.log(this.response.length);
             location.href = url;
             }
             }

             xmlhttp.send();*/

            OC.redirect(this.getDownloadUrl(files, dir));

            return false;

        },

        _onClickPrintSelected: function (event) {
            if (this.getSelectedFiles().length === 1) {
                var id = '' + _.first(this.getSelectedFiles()).id;
                var file = _.findWhere(_.map(this.files, function (e) {
                    //e.id = +e.id;
                    return e;
                }), {id: id});
                var h = 500;
                var url = OC.generateUrl('/core/preview.png?') + "file=" + (this.getCurrentDirectory() + '/' + file.name).replace('//', '/') + "&c=" + file.etag + "&y="+h;
                printHTML('<img src="'+url+'"/>');
            }
            function printHTML(htmlString) {
                var newIframe = document.createElement('iframe');
                newIframe.width = '1px';
                newIframe.height = '1px';
                newIframe.src = '';

                // for IE wait for the IFrame to load so we can access contentWindow.document.body
                newIframe.onload = function() {
                    var script_tag = newIframe.contentWindow.document.createElement("script");
                    script_tag.type = "text/javascript";
                    var script = newIframe.contentWindow.document.createTextNode('function Print(){ window.focus(); window.print(); }');
                    script_tag.appendChild(script);

                    newIframe.contentWindow.document.body.innerHTML = htmlString;
                    newIframe.contentWindow.document.body.appendChild(script_tag);

                    // for chrome, a timeout for loading large amounts of content
                    setTimeout(function() {
                        newIframe.contentWindow.Print();
                        newIframe.contentWindow.document.body.removeChild(script_tag);
                        newIframe.parentElement.removeChild(newIframe);
                    }, 3000);
                };
                document.body.appendChild(newIframe);
            }
        },
        _onClickShareSelected: function (event) {
            OC.Share.renderSharingMenu();
        },
        /**
         * Event handler for when clicking on "Delete" for the selected files
         */
        _onClickDeleteSelected: function (event) {
            var self = this;
            files = null;
            var types = [];
            if (!this.isAllSelected()) {
                files = _.pluck(this.getSelectedFiles(), 'name');
                types = _.uniq(_.pluck(this.getSelectedFiles(), 'type'));
            }
            var mes = '',
                qty_selected_message = '';
            var typeFile = 'файла';
            if(_.first(types) == 'file'){
                if (files.length >= 5 && files.length <= 19 || files.length % 10  >= 5 && files.length % 10 <= 9 || 0) {
                    var typeFile = 'файлов'
                } else if(files.length % 10  == 1 ){
                    var typeFile = 'файл'
                }else if(files.length >= 2 || files.length <= 4){
                    var typeFile = 'файла'
                }
            }else{
                if (files.length >= 5 && files.length <= 19 || files.length % 10  >= 5 && files.length % 10 <= 9 || 0) {
                    var typeFile = 'папок'
                } else if(files.length % 10  == 1 ){
                    var typeFile = 'папку'
                }else if(files.length >= 2 || files.length <= 4){
                    var typeFile = 'папки'
                }
            }
            var type = (types.length>1)? 'element' : typeFile;
            if(files.length > 1) {
                qty_selected_message = 'Вы дейстительно хотите удалить  %n ' + typeFile;
                mes = n('files', qty_selected_message, qty_selected_message,files.length);
            } else {
                qty_selected_message = 'Вы действительно хотите удалить';
                mes = t('files', qty_selected_message)+ " '" + getDeletedFileName(_.pluck(this.getSelectedFiles(), 'name')) + "'";
            }

            popupShow(t('files', 'Remove'),
                mes+'?',
                '<div data-action="Delete" class="button delete-button">'+t('files', 'Remove')+'</div>' +
                '<div data-action="cancel" class="button cancel-button popup-ok">'+t('files', 'Cancel')+'</div>'
            );

            $('body').one('click', '[data-action="Delete"]', function(){

                self.do_delete(files, types);
                popupHide();
            });
            $('body').on('click', '[data-action="cancel"]', function () {
                popupHide();
            });
            return false;
        },
        _onClickUndelete: function (event) {
            this.do_undelete(this.deletedFiles, this.getCurrentDirectory());
            this.deletedFiles = [];
            this.deletedTypes = [];
        },
        _showContextMenu: function (event) {
            if (this.id === 'files') {
                this.contextId = event.currentTarget.dataset.id;
                this.contextPath = event.currentTarget.dataset.path;
                $('.custom-menu').toggle();
                $('.custom-menu').css({top: -40 + event.screenY + "px", left: event.screenX + "px", zIndex: 901});
            } else {
                this.destroy();
            }
        },
        _contextCreateFolder: function (event) {
            path = this.contextPath;
            OC.dialogs.inputText(t('files', 'Create'),
                function (keep, name) {
                    if (keep) {
                        $.post(
                            OC.filePath('files', 'ajax', 'newfolder.php'),
                            {
                                dir: path + "/",
                                foldername: name
                            },
                            function (result) {
                                if (result.status === 'success') {
                                } else {
                                    OC.dialogs.alert(result.data.message, t('core', 'Could not create folder'));
                                }
                            }
                        );
                    }
                }
            );

        },
        _contextRenameFolder: function (event) {
            path = this.contextPath;
            oldname = _.findWhere(this.files, {'id': this.contextId}).name;
            OC.dialogs.inputText(t('files', 'Rename folder'), t('files', 'Rename'),
                function (keep, name) {
                    oldName = path.substring(path.lastIndexOf('/') + 1);
                    path = path.replace(oldName, '');
                    if (keep) {
                        $.ajax({
                            url: OC.filePath('files', 'ajax', 'rename.php'),
                            data: {
                                dir: path,
                                newname: name,
                                file: oldName
                            },
                            success: function (result) {
                            }
                        });
                    }
                },true,oldname);
            $(".custom-menu").hide();
        },
        _searchByTag: function (event) {
            var e = jQuery.Event("keyup");
            e.which = 13;
            $('#searchbox').val(event.currentTarget.dataset.tag).trigger(e);
            this.showResults();
            $.ajax({
                    url: OC.filePath('files', 'ajax', 'populateTag.php'),
                    data: {tag: event.currentTarget.dataset.tag},
                    async: true
                }
            );
        },
        _searchByTagAutocomplete: function (tag) {
            var e = jQuery.Event("keyup");
            e.which = 13;
            $('#searchbox').val(tag).trigger(e);
            this.showResults();
            $.ajax({
                    url: OC.filePath('files', 'ajax', 'populateTag.php'),
                    data: {tag: tag},
                    async: true
                }
            );
        },
        _searchByTagOnRight: function (event) {
            var e = jQuery.Event("keyup");
            e.which = 13;
            $('#searchbox').val($(event.currentTarget).text()).trigger(e);
            //this.runSearch();
            this.showResults();
            $.ajax({
                url: OC.filePath('files', 'ajax', 'populateTag.php'),
                data: {tag: $(event.currentTarget).text()},
                async: true
            });
            $('body').scrollTop();
        },
        _searchByTagFromGallery: function () {
            var url = OC.Util.History.parseUrlQuery();
            if(url.tagsearch == undefined){
                return
            }
            var tag = url.tagsearch;
            var e = jQuery.Event("keyup");
            e.which = 13;
            $('#searchbox').val(tag);
            //this.runSearch();
            this.setFilter(tag);
            this.showResults();
            $.ajax({
                url: OC.filePath('files', 'ajax', 'populateTag.php'),
                data: {tag: tag},
                async: true
            });
            $('body').scrollTop();
        },
        _contextDownloadFolder: function (event) {
            var path = this.contextPath;
            file = path.substring(path.lastIndexOf('/') + 1);
            dir = path.replace(file, '');
            window.open(OCA.Files.Files.getDownloadUrl(file, dir));
        },
        _getChildTree: function (event) {
            if (this.id === 'files') {
                id = event.currentTarget.dataset.id;
                $('body').find('#treeNode_' + id).dblclick();
            }else {
                this.destroy();
            }
        },
        _selectTreeFolderItem: function (event) {
            $(".custom-menu").hide();
            if (this.id === 'files') {
                if (window.location.toString().indexOf('view=trashbin') >= 0)
                    $("#app-navigation").find("li[data-id='files'] a").click();
                this.changeDirectory(event.currentTarget.dataset.dir);
                $('.treeList *').css('background', 'none');
                if ($(event.currentTarget).parent().css('background-color') === 'rgb(204, 204, 204)')
                    $(event.currentTarget).parent().css('background', 'none');
                else
                    $(event.currentTarget).parent().css('background', '#ccc');
            }
        },
        _getTrashbin: function (event) {
            $("#app-navigation").find("li[data-id='trashbin'] a").click();
        },
        _showMainContextOnRightClick: function (event) {
            var self = this;
            var url = OC.Util.History.parseUrlQuery();
            switch (event.which) {
                case 3:
                    $('.main-context').remove();
                    var menuListParams = {};
                    if (!$(event.target).closest('#fileList li').length) {
                        menuListParams = {
                            'Create': {
                                img: 'create-folder',
                                className: 'main-context-create'
                            },
                            'Upload': {
                                img: 'upload',
                                className: 'main-context-upload'
                            },
                            'Upload folder': {
                                img: 'upload-folder',
                                className: 'main-context-upload-folder'
                            }
                        };
                    } else {
                        self.contextId = $(event.target).closest('#fileList li').attr('data-id');
                        self.contextId = self.contextId || parseFloat(self.contextId);
                        var file = _.findWhere(self.files.concat(OC.Search.lastResults), {id:self.contextId+''});
                        if (file == undefined) file = _.findWhere(self.files.concat(OC.Search.lastResults), {id:parseInt(self.contextId)});
                        self.contextPath = file.fullPath.replace(file.name, '');
                        self.contextFile = file.name;
                        self.contextType = file.type;
                        self._onClickFile(event);
                        if (file === 'dir') {
                            this.contextPath += this.contextFile;
                        }
                        menuListParams = {
                            'Download': {
                                img: 'upload-file',
                                className: 'main-context-download'
                            },
                            'Move': {
                                img: 'move',
                                className: 'main-context-move'
                            },
                            'Copy': {
                                img: 'copy',
                                className: 'main-context-copy'
                            },
                            'Delete': {
                                img: 'remove',
                                className: 'main-context-delete'
                            },
                            'Access settings': {
                                img: 'shared',
                                className: 'context-share'
                            },
                            'Rename': {
                                img: 'edit',
                                className: 'main-context-rename'
                            },
                            'Share': {
                                img: 'share',
                                className: '',
                                subMenus: {
                                    'vkontakte': 'To send through',
                                    'facebook': 'To send through',
                                    'ok': 'To send through',
                                    'twitter': 'To send through',
                                    'g-plus': 'To send through',
                                    'mail': 'To send through'
                                }
                            }
                        };
                        // Andrew
                        if(url != undefined && url.view != undefined && url.view == 'shared')
                            menuListParams = {
                                'Download': {
                                    img: 'upload-file',
                                    className: 'main-context-download'
                                },
                                /*'Move': {
                                 img: 'move',
                                 className: 'main-context-move'
                                 },*/
                                'Copy': {
                                    img: 'copy',
                                    className: 'main-context-copy'
                                },
                                'Delete': {
                                    img: 'remove',
                                    className: 'main-context-delete'
                                },
                                'Access settings': {
                                    img: 'shared',
                                    className: 'context-share'
                                },
                                'Rename': {
                                    img: 'edit',
                                    className: 'main-context-rename'
                                },
                                'Share': {
                                    img: 'share',
                                    className: '',
                                    subMenus: {
                                        'vkontakte': 'To send through',
                                        'facebook': 'To send through',
                                        'ok': 'To send through',
                                        'twitter': 'To send through',
                                        'g-plus': 'To send through',
                                        'mail': 'To send through'
                                    }
                                }
                            };
                        //trashbin
                        if(file.mountType === 'trashbin'){
                            menuListParams = {
                                'Move': {
                                    img: 'move',
                                    className: 'main-context-move'
                                },
                                'Delete': {
                                    img: 'remove',
                                    className: 'main-context-delete'
                                },
                                'Restore': {
                                    img: 'restore',
                                    className: 'main-context-restore'
                                }
                            };
                        }
                    }
                function _renderMenu(obj) {
                    var menuListParams = obj;
                    var $menu = $('<div>').addClass('main-context');
                    var ext = "-ico.png";
                    var $menuList = $('<ul>');
                    var html = '';
                    for (var name in menuListParams) {
                        html += '<li>' +
                            '<span class="' + menuListParams[name].className + '">' +
                            '<span><img src="' + OC.imagePath('core', menuListParams[name].img + ext) + '"></span>' + t('files', name) +
                            '</span>' + renderSubmenu(menuListParams[name].subMenus) +
                            '</li>';
                    }
                    $menuList.append(html);
                    $menu.append($menuList);

                    function renderSubmenu(subMenus) {
                        if (typeof subMenus === 'undefined') {
                            return '';
                        }
                        var sub_html = '<div class="sub-context"><ul>';
                        for (var sub_name in subMenus) {
                            sub_html += '<li>' +
                                '<span id="' + sub_name + '">' +
                                t('files', subMenus[sub_name]) + '<img src = "' + OC.imagePath('core', sub_name + ext) + '" > ' +
                                ' </span>' +
                                '</li> ';
                        }
                        sub_html += '</ul></div>';
                        return sub_html;
                    }

                    if (!$('.main-context').length) {
                        self.$el.append($menu);
                        $menu.find('.sub-context').parents('li').addClass('sub');
                    }
                };
                    _renderMenu(menuListParams);
                    $('.main-context').fadeIn();
                    var windowWidth = $(window).width(),
                        windowHeight = $(window).height(),
                        contextMenuWidth = $('.main-context').outerWidth(),
                        contextMenuHeight = $('.main-context').outerHeight(),
                        contextMenuSubWidth = $('.main-context .sub-context').outerWidth(),
                        contextMenuSubHeight = $('.main-context .sub-context').outerHeight(),
                        leftWidth = event.pageX,
                        topHeight = event.clientY;
                    if(leftWidth > windowWidth-contextMenuWidth){
                        leftWidth = windowWidth-contextMenuWidth;
                        $('.main-context .sub-context').css({
                            'right': 'auto',
                            'left': -contextMenuWidth+'px'
                        });
                    } else if(leftWidth > windowWidth-contextMenuWidth-contextMenuSubWidth) {
                        $('.main-context .sub-context').css({
                            'right': 'auto',
                            'left': -contextMenuWidth+'px'
                        });
                    }
                    if(topHeight > windowHeight-contextMenuHeight){
                        topHeight = windowHeight-contextMenuHeight;
                        contextMenuSubHeight = contextMenuSubHeight - $('.main-context .sub-context').closest('.sub').outerHeight();
                        $('.main-context .sub-context').css({
                            'top': -contextMenuSubHeight+'px'
                        });
                    } else if (topHeight > windowHeight-contextMenuHeight-contextMenuSubHeight) {
                        contextMenuSubHeight = contextMenuSubHeight - $('.main-context .sub-context').closest('.sub').outerHeight();
                        $('.main-context .sub-context').css({
                            'top': -contextMenuSubHeight+'px'
                        });
                    }
                    $('.main-context').css({top: topHeight + "px", left: leftWidth + "px"});
                    break;
                default:
                    $('.main-context').fadeOut(200, function () {
                        $(this).remove();
                    });
            }
            event.stopPropagation();
            $(document).click(function (event) {
                $('.main-context').fadeOut(200, function () {
                    $(this).remove();
                });
            });
            $(document).on('scroll', function(){
                $('.main-context').fadeOut(200, function () {
                    $(this).remove();
                });
            });
        },
        _mainContextCreateFolder: function () {
            var path = this.getCurrentDirectory();
            $('.main-context').hide();
            self = this;
            popupShow(t('files', 'Folder name'),
                '<input class="createFolder" type="text" value="'+t('files', 'New folder')+'" />',
                '<div data-action="ok" class="button create-button"> '+
                t('files', 'Create')+
                '</div>' +
                '<div data-action="cancel" class="button cancel-button popup-ok">'+
                t('files', 'Cancel')+
                '</div>'
            );
            $('body').one('click', '[data-action="ok"]', function(){
                var name = $('.createFolder').val();
                $.post(
                    OC.filePath('files', 'ajax', 'newfolder.php'),
                    {
                        dir: path,
                        foldername: name
                    },
                    function (result) {
                        if (result.status === 'success') {
                            //self.files = self.files.concat(OC.Search.lastResults);
                            self.reload();
                        } else {
                            popupShow(t('core', 'Could not create folder'), result.data.message, '<div data-action="cancel" class="button popup-ok">'+
                                t('files', 'Ok')+
                                '</div>');
                        }
                    }
                );
                popupHide();
            });
            $('body').on('click', '[data-action="cancel"]', function () {
                popupHide();
            });
        },
        _mainContextRename: function () {
            var path = this.contextPath,
                oldName = this.contextFile,
                type = this.contextType,
                oldFileName = oldName.replace(/\.[0-9a-z]+$/i,''),
                extension = oldName.replace(oldFileName, ''),
                self = this;
            path = path.replace(this.contextFile, "");

            if(type === 'file'){
                oldName = oldName.substring(0, oldName.lastIndexOf('.'));
            }
            if(type === 'dir'){
                extension = '';
            }

            popupShow(t('files', 'Rename'),
                '<label for="renameInput" id="renameInputLabel"></label><input id="renameInput" class="renameInput" type="text" value="'+oldName+'" />',
                '<div data-action="ok" class="button create-button rename-button"> '+
                t('files', 'Rename')+
                '</div>' +
                '<div data-action="cancel" class="button cancel-button popup-ok">'+
                t('files', 'Cancel')+
                '</div>'
            );
            $('body').on('click', '.rename-button[data-action="ok"]', function(){
                var newName = $('#popup .renameInput').val();
                if(newName == ""){
                    var error = $('<span>').addClass('form-error').text(t('files','File name cannot be empty.')).fadeIn();
                    $('#renameInputLabel').append(error);
                    return;
                }

                $.ajax({
                    url: OC.filePath('files', 'ajax', 'rename.php'),
                    data: {
                        dir: path,
                        newname: newName+extension,
                        file: self.contextFile
                    },
                    success: function (result) {
                        if (result.status === 'success') {
                            var id = result.data.id;
                            var thisModelObj = _.findWhere(self.files, {id: id + ''});
                            thisModelObj.name = result.data.name;
                            self.contextFile = result.data.name;
                            $('#fileList li[data-id="' + id + '"] .filename .innernametext').contents().first()[0].textContent = '' + result.data.name.replace(extension, '');
                            if (type != 'dir') $('#fileList li[data-id="' + id + '"] .filename .extension').contents().first()[0].textContent = extension;
                            $('#fileList li[data-id="' + id + '"]').attr('data-file', result.data.name);
                            $('#fileList li[data-id="' + id + '"] .filesize .date span').text(result.data.date);
                            popupHide();
                        } else {
                            var error = $('<span>').addClass('form-error').text(t('files', result.data.message)).fadeIn();
                            $('#renameInputLabel').append(error);
                        }
                    }
                });

            });
            $('body').one('click', '.cancel-button[data-action="cancel"]', function () {
                popupHide();
            });
        },
        _mainContextDelete: function () {
            $('.main-context').hide();
            var path = this.contextPath;
            var id = this.contextId;
            var filename = this.contextFile;
            var self = this;
            var files = _.pluck(self.getSelectedFiles(), 'name');
            var mounttypes =_.without(_.uniq(_.pluck(self.getSelectedFiles(), 'mounttype')), null);

            var types = _.without(_.uniq(_.pluck(self.getSelectedFiles(), 'type')), null);
            var mes = '',
                qty_selected_message = '';
            var type = (types.length>1)? 'element' : _.first(types);
            if(files.length > 1) {
                qty_selected_message = 'Are you sure you want to delete  %n ' + type;
                mes = n('files', qty_selected_message, qty_selected_message+'s',files.length);
            } else {
                qty_selected_message = 'Вы действительно хотите удалить';
                mes = t('files', qty_selected_message)+ " '" + filename + "'";
            }
            if(mounttypes == 'external'){
                popupShow(t('files', 'Delete'),
                    mes+'?',
                    '<div data-action="Delete" class="button delete-button"> '+
                    t('files', 'Delete')+
                    ' </div><div data-action="cancel" class="button cancel-button popup-ok">'+
                    t('files', 'Cancel')+'</div>'
                );
                $('body').on('click', '[data-action="Delete"]', function(){

                    var params= {};
                    params = {dir: path, files: "[\"" + filename + "\"]"};
                    files = _.pluck(self.getSelectedFiles(), 'name');
                    self._folders();
                    if (files.length === 0) {
                        self.do_delete(filename);
                    } else {
                        self.do_delete(files, types);
                    }
                    self._selectedFiles = {};
                    self._controlProperties();
                    popupHide();
                });
                $('body').on('click', '[data-action="cancel"]', function () {
                    popupHide();
                });
            } else {
                return;
            }

        },
        // popup explorers functions
        _createExplorerRow: function(target, data) {
            var current = target;
            var childrensBlock = $('<div class="childrensBlock">');
            _.each(data, function(data){
                var explorerListItem = $('<div class="explorerListItem">'),
                    content = $('<div class="explorerListItemContent" data-id="'+data.id+'" data-path="'+data.fullPath+'">'),
                    name = $('<div class="dirName">'),
                    folderIcon = $('<div class="folder-icon">'),
                    toChild = $('<div" class="nextFolder">'),
                    insert = $('<div class="button insert">'+t('files', 'Insert')+'</div>'),
                    create = $('<div class="create" title="'+t('files', 'Create folder')+'">' +
                        '<img src="'+OC.filePath('core', 'img', 'create-folder-ico.png')+'">' +
                        '</div>');
                if(data.hasChild == false || data.hasChild == undefined){
                    toChild = '';
                }
                if(data.shared == true){
                    folderIcon.addClass('shared');
                }
                name.text(data.name);
                content.append([toChild, folderIcon, name, insert, create]);
                explorerListItem.append(content);
                childrensBlock.append(explorerListItem);
                current.parent().parent().find('.childrensBlock').remove();
                current.parent().parent().append(childrensBlock);
            });
            current.parent().parent().find('.childrensBlock').slideDown(200, function(){
                current.addClass('toggled');
            });
        },
        _mainContextMoveOpenFolder: function(current, req){
            var self = this;
            var path = current.parent().data('path');
            var currentChilds = current.parent().parent().find('.childrensBlock');
            if (!currentChilds.length) {
                $.when(
                    $.ajax({
                        url: OCA.Files.Files.getAjaxUrl(req, {dir: path}),
                        dataType: "json"
                    })
                ).done(function(response){
                        var data = response.data.files;
                        self._createExplorerRow(current, data);
                    });
            } else {
                if(current.hasClass('toggled')) {
                    current.closest('.explorerListItem').find('.childrensBlock').slideUp(200, function(){
                        current.removeClass('toggled');
                    });
                } else {
                    current.closest('.explorerListItem').find('.childrensBlock').slideDown(200, function(){
                        current.addClass('toggled');
                    });
                }
            }
        },
        _mainContextMove: function () {
            var self = this;
            var explorerList = $('<div id="explorerList">' +
                '<div class="explorerListItem">' +
                '<div class="explorerListItemContent" data-path="/">'+
                '<div class="nextFolder"></div>' +
                '<div class="folder-icon my-disk-folder"></div>'+
                '<div class="dirName">'+t('files', 'My disk')+'</div>' +
                '<div class="button insert">'+t('files', 'Insert')+'</div>' +
                '<div class="create" title="'+t('files', 'Create folder')+'">' +
                '<img src="'+OC.filePath('core', 'img', 'create-folder-ico.png')+'">' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>');
            var qtyElems =  n('files', '%n element', '%n elements', self.getSelectedFiles().length);
            popupShow(
                '<div class="explorerTitle">'+t('files', 'Moving')+'<div class="explorerUnderTitle">'+qtyElems+'</div></div>',
                explorerList,
                '',
                'explorerPopup'
            );
            $('#explorerList').on('click', '.nextFolder', function(e){
                var current = $(this);
                self._mainContextMoveOpenFolder(current, 'filestreedirs');
                $('#explorerList .nextFolder').off('click');
            });
            explorerList.on('dblclick', '.explorerListItemContent', function(){
                var current = $(this).find('.nextFolder');
                self._mainContextMoveOpenFolder(current, 'filestreedirs');
            });
            $('#explorerList').on('click', '.insert', function(){
                var currentDir = self.getCurrentDirectory();
                var filename = _.pluck(self.getSelectedFiles(), 'name');
                var fullPath = $(this).parent().attr('data-path');
                $.post(
                    OC.filePath('files', 'ajax', 'move.php'),
                    {
                        dir: currentDir,
                        file: filename,
                        target: fullPath
                    }, function (result) {
                        if (result.status === 'success') {
                            popupHide();
                            self.changeDirectory(fullPath);
                        } else {
                            $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+result.data.message);
                        }
                    }
                )
            });
            $('#explorerList').on('click', '.create', function(){
                var current = $(this);
                var fullPath = current.parent().attr('data-path');
                var name = t('files', 'New folder');
                $.post(
                    OC.filePath('files', 'ajax', 'newfolder.php'),
                    {
                        dir: fullPath + "/",
                        foldername: name
                    },
                    function (response) {
                        if (response.status === 'success') {
                            var newFolderId = response.data.id
                            var data = [];            //
                            data.push(response.data); //need coz _createExplorerRow expect array
                            self._createExplorerRow(current, data);
                            //add toggle
                            var toChild = $('<div" class="nextFolder toggled">');
                            if(!current.parent().find('.nextFolder').length){
                                current.parent().prepend(toChild);
                            }
                            var newFolderName = $('#explorerList .explorerListItemContent[data-id="'+newFolderId+'"] .dirName'),
                                newFolderNameInput = $('<input class="dirNameInput" type="text" value="'+newFolderName.text()+'">');
                            newFolderName.replaceWith(newFolderNameInput);
                            newFolderNameInput.focus().select();
                            newFolderNameInput.on('blur', function(){
                                var inputVal = $(this).val(),
                                    thisFolderPath = $('#explorerList .dirNameInput').closest('.explorerListItemContent').attr('data-path'),
                                    parentFolderPath = OC.dirname(thisFolderPath)+'/';
                                if(inputVal != '' && newFolderName.text() != inputVal){
                                    inputVal = inputVal.replace(/[&\/\\#,+()$~%.'":*?<>{}]/g,'');
                                    $.ajax({
                                        url: OC.filePath('files','ajax','rename.php'),
                                        data: {
                                            dir : parentFolderPath,
                                            newname: inputVal,
                                            file: newFolderName.text()
                                        },
                                        success: function(result) {
                                            if(result.status === 'success'){
                                                //change data-path
                                                var newpath = result.data.path + "/" + inputVal;
                                                $(newFolderNameInput).parent().attr('data-path', newpath);

                                                newFolderNameInput.replaceWith($('<div class="dirName">'+inputVal+'</div>'));
                                                $('#popup.explorerPopup .popup-buttons').html('');
                                            } else {
                                                $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+result.data.message);
                                            }
                                        }
                                    });
                                } else if(inputVal == '') {
                                    $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+'Enter a name of this folder');
                                } else if (newFolderName.text() == inputVal){
                                    newFolderNameInput.replaceWith($('<div class="dirName">'+inputVal+'</div>'));
                                    $('#popup.explorerPopup .popup-buttons').html('');
                                }else {
                                    $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+'Error');
                                }
                            });
                        } else {
                            $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+response.data.message);
                        }
                    }
                );
            });
        },
        _mainContextCopy: function () {
            var self = this;
            var explorerList = $('<div id="explorerList">' +
                '<div class="explorerListItem">' +
                '<div class="explorerListItemContent" data-path="/">'+
                '<div class="nextFolder"></div>' +
                '<div class="folder-icon my-disk-folder"></div>'+
                '<div class="dirName">'+t('files', 'My disk')+'</div>' +
                '<div class="button insert">'+t('files', 'Insert')+'</div>' +
                '<div class="create" title="'+t('files', 'Create folder')+'">' +
                '<img src="'+OC.filePath('core', 'img', 'create-folder-ico.png')+'">' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>');
            var qtyElems =  n('files', '%n element', '%n elements', self.getSelectedFiles().length);
            popupShow(
                '<div class="explorerTitle">'+t('files', 'Copying')+'<div class="explorerUnderTitle">'+qtyElems+'</div></div>',
                explorerList,
                '',
                'explorerPopup'
            );
            $('#explorerList').on('click', '.nextFolder', function(e){
                var current = $(this);
                self._mainContextMoveOpenFolder(current, 'filestreedirs');
                $('#explorerList .nextFolder').off('click');
            });
            explorerList.on('dblclick', '.explorerListItemContent', function(){
                var current = $(this).find('.nextFolder');
                self._mainContextMoveOpenFolder(current, 'filestreedirs');
            });

            insertHandler();
            function insertHandler(){
                $('#explorerList').on('click', '.insert', function(){
                    //All this for know mountType
                    var mountType = false;
                    var fileid = false;
                    for (var file in self._selectedFiles) {
                        fileid = self._selectedFiles[file].id;
                        break;
                    }

                    for (var file in self.files) {
                        if(self.files[file].id == fileid) {
                            mountType = self.files[file].mountType;
                            break;
                        }
                    }
                    var currentDir = "/";
                    if(mountType !== 'shared-root'){
                        var currentDir = self.getCurrentDirectory();
                    }

                    var filename = _.pluck(self.getSelectedFiles(), 'name');
                    var fullPath = $(this).parent().attr('data-path');
                    $.post(
                        OC.filePath('files', 'ajax', 'copy.php'),
                        {
                            dir: currentDir,
                            file: filename,
                            target: fullPath
                        }, function (result) {
                            if (result.status === 'success') {
                                $('#explorerList').off('click', '.insert');
                                $('#explorerList .insert').addClass('disabled');
                                popupHide();
                                var url = OC.Util.History.parseUrlQuery();
                                delete(url.view);
                                self.changeDirectory(fullPath);
                            } else {
                                $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+result.data.message);
                            }
                        }
                    )

                    $('#explorerList').off('click', '.insert');
                    $('#explorerList .insert').addClass('disabled');
                    setTimeout(function () {
                        insertHandler();
                        $('#explorerList .insert').removeClass('disabled');
                    }, 1500);
                });
            }

            $('#explorerList').on('click', '.create', function(){
                var current = $(this);
                var fullPath = current.parent().attr('data-path');
                var name = t('files', 'New folder');
                $.post(
                    OC.filePath('files', 'ajax', 'newfolder.php'),
                    {
                        dir: fullPath + "/",
                        foldername: name
                    },
                    function (response) {
                        if (response.status === 'success') {
                            var newFolderId = response.data.id
                            var data = [];            //
                            data.push(response.data); //need coz _createExplorerRow expect array
                            self._createExplorerRow(current, data);
                            //add toggle
                            var toChild = $('<div" class="nextFolder toggled">');
                            if(!current.parent().find('.nextFolder').length){
                                current.parent().prepend(toChild);
                            }
                            var newFolderName = $('#explorerList .explorerListItemContent[data-id="'+newFolderId+'"] .dirName'),
                                newFolderNameInput = $('<input class="dirNameInput" type="text" value="'+newFolderName.text()+'">');
                            newFolderName.replaceWith(newFolderNameInput);
                            newFolderNameInput.focus().select();
                            newFolderNameInput.on('blur', function(){
                                var inputVal = $(this).val(),
                                    thisFolderPath = $('#explorerList .dirNameInput').closest('.explorerListItemContent').attr('data-path'),
                                    parentFolderPath = OC.dirname(thisFolderPath)+'/';
                                if(inputVal != '' && newFolderName.text() != inputVal){
                                    inputVal = inputVal.replace(/[&\/\\#,+()$~%.'":*?<>{}]/g,'');
                                    $.ajax({
                                        url: OC.filePath('files','ajax','rename.php'),
                                        data: {
                                            dir : parentFolderPath,
                                            newname: inputVal,
                                            file: newFolderName.text()
                                        },
                                        success: function(result) {
                                            if(result.status === 'success'){
                                                //change data-path
                                                var newpath = result.data.path + "/" + inputVal;
                                                $(newFolderNameInput).parent().attr('data-path', newpath);

                                                newFolderNameInput.replaceWith($('<div class="dirName">'+inputVal+'</div>'));
                                                $('#popup.explorerPopup .popup-buttons').html('');
                                            } else {
                                                $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+result.data.message);
                                            }
                                        }
                                    });
                                } else if(inputVal == '') {
                                    $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+'Enter a name of this folder');
                                } else if (newFolderName.text() == inputVal){
                                    newFolderNameInput.replaceWith($('<div class="dirName">'+inputVal+'</div>'));
                                    $('#popup.explorerPopup .popup-buttons').html('');
                                }else {
                                    $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+'Error');
                                }
                            });
                        } else {
                            $('#popup.explorerPopup .popup-buttons').html('<img class="error" src="'+OC.imagePath('core', 'error-ico.png')+'">'+response.data.message);
                        }
                    }
                );
            });
        },
        checkFileExists: function(){
            return  $.ajax({
                url : OC.filePath('files', 'ajax', 'checkFileExists.php'),
                data:{
                    dir : dir,
                    file: file
                },
                type: "POST",
                async: false
            });
        },
        _mainContextDownload: function (){
            $('.under-logo-notifications').find('.loading-page').text(t('files','LoadingDownload')+"...").prepend('<img class="loading-ico" src="'+OC.imagePath('core', 'loading-ico.png')+'">');

            //All this for know mountType
            var mountType = false;
            var fileid = false;
            for (var file in this._selectedFiles) {
                fileid = this._selectedFiles[file].id;
                break;
            }

            for (var file in this.files) {
                if(this.files[file].id == fileid) {
                    mountType = this.files[file].mountType;
                    break;
                }
            }

            if(mountType == 'shared-root'){
                var files = new Array();
                for (var file in this._selectedFiles) {
                    files.push(this._selectedFiles[file].name);
                }
                var dir = this._currentDirectory;
                OC.redirect(OCA.Files.Files.getShareDownloadUrl(files, dir));

            } else {
                var path = this.contextPath + "/" + this.contextFile;
                $('.main-context').hide();
                var file = path.substring(path.lastIndexOf('/') + 1);
                var dir = path.replace(file, '');
                OC.redirect(OCA.Files.Files.getDownloadUrl(file, dir));
            }
        },

        _treeContextDownload: function (){
            var mountType = ($('.explorerListItemContent.active').parents('.explorerListItem.share').length == 1) ? 'shared-root' : '';
            var filepath = $('.explorerListItemContent.active').data('path');

            if(mountType == 'shared-root'){
                var files = new Array();
                var name = OC.basename(filepath);
                var dir = OC.dirname(filepath);
                files.push(name);
                OC.redirect(OCA.Files.Files.getShareDownloadUrl(files, dir));

            } else {
                var path = this.contextPath + "/" + this.contextFile;
                $('.main-context').hide();
                var file = path.substring(path.lastIndexOf('/') + 1);
                var dir = path.replace(file, '');
                OC.redirect(OCA.Files.Files.getDownloadUrl(file, dir));
            }
        },
        _unsharePermissons: function (event) {
            sharedata = event.currentTarget.dataset;
            unshare = $.ajax({
                type: 'POST',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    action: "unshare",
                    itemType: sharedata.itemtype,
                    itemSource: sharedata.itemsource,
                    shareType: 0,
                    shareWith: sharedata.sharewith
                },
                async: false
            }).responseJSON;
            if (unshare.status === "success") {
                $('#body-user').find("div.shared-to-user a.unshare").text(t("files", "Restore"));
                $('#body-user').find("div.shared-to-user a.unshare").addClass("return-share");
                $('#body-user').find("div.shared-to-user a.unshare").removeClass("unshare");
            }
        },
        _returnSharePermissons: function (event) {
            sharedata = event.currentTarget.dataset;
            share = $.ajax({
                type: 'POST',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    action: "share",
                    itemType: sharedata.itemtype,
                    itemSource: sharedata.itemsource,
                    shareType: sharedata.sharetype,
                    shareWith: sharedata.sharewith,
                    permissions: 19,
                    itemSourceName: sharedata.itemsourcename
                },
                async: false
            }).responseJSON;
            if (share.status === "success") {
                $('#body-user').find("div.shared-to-user a.return-share").text(t("files", "Delete"));
                $('#body-user').find("div.shared-to-user a.return-share").addClass("unshare");
                $('#body-user').find("div.shared-to-user a.return-share").removeClass("return-share");
            }
        },
        _unsharePublicPermissons: function (event) {
            sharedata = event.currentTarget.dataset;
            unshare = $.ajax({
                type: 'POST',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    action: "unshare",
                    itemType: sharedata.itemtype,
                    itemSource: sharedata.itemsource,
                    shareType: sharedata.sharetype,
                    shareWith: ""
                },
                async: false
            }).responseJSON;
            if (unshare.status === "success") {
                $('#body-user').find("div.shared-by-link a.unshare").text(t("files", "Restore"));
                $('#body-user').find("div.shared-by-link a.unshare").addClass("return-share");
                $('#body-user').find("div.shared-by-link a.unshare").removeClass("unshare");
            }
        },
        _returnPublicSharePermissons: function (event) {
            sharedata = event.currentTarget.dataset;
            share = $.ajax({
                type: 'POST',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    action: "share",
                    itemType: sharedata.itemtype,
                    itemSource: sharedata.itemsource,
                    shareType: sharedata.sharetype,
                    shareWith: '', // password
                    expirationDate: '', // date to
                    permissions: 1,
                    itemSourceName: sharedata.itemsourcename
                },
                async: false
            }).responseJSON;
            if (share.status === "success") {
                $('#body-user').find("div.shared-by-link a.link").attr("href","//" + document.domain.toString() + "/index.php/s/" + share.data.token);
                $('#body-user').find("div.shared-by-link a.link").text(window.location.protocol + "//" + document.domain.toString() + "/index.php/s/" + share.data.token);
                $('#body-user').find("div.shared-by-link a.return-share").text(t("files", "Delete"));
                $('#body-user').find("div.shared-by-link a.return-share").addClass("unshare");
                $('#body-user').find("div.shared-by-link a.return-share").removeClass("return-share");
            }
        },
        _createPublicShareLink: function (event) {
            permissions = _.pluck(_.where($(".share-public-checkboxes").children(), {'localName': 'input', 'checked': true}), 'name'); // .currentTarget.parentElement.lastChild.children(input)
            setPermissions = 1;

            for (i = 0, l = permissions.length; i < l; i++) {
                switch (permissions[i]) {
                    case "comment":
                        setPermissions += OC.PERMISSION_COMMENT
                        break
                    case "download":
                        setPermissions += OC.PERMISSION_DOWNLOAD
                        break
                    case "upload":
                        setPermissions += OC.PERMISSION_CREATE
                        break
                    case "delete":
                        setPermissions += OC.PERMISSION_DELETE;
                        break
                }
            }
            sharedata = event.currentTarget.dataset;
            share = $.ajax({
                type: 'POST',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    action: "share",
                    itemType: sharedata.itemtype,
                    itemSource: sharedata.itemsource,
                    shareType: sharedata.sharetype,
                    shareWith: '', // password
                    expirationDate: '', // date to
                    permissions: setPermissions,
                    itemSourceName: sharedata.itemsourcename
                },
                async: false
            }).responseJSON;
            if (share.status === "success") {
                $(".under-logo-notifications").find('.share').text(t('files', 'Shared'));
                setTimeout(function () {
                    $(".under-logo-notifications").find('.share').text(t('files', ''));
                }, 5000);
                $(".show-new-share").attr("href",window.location.protocol + "//" + document.domain.toString() + "/index.php/s/" + share.data.token);
                $(".show-new-share").text(window.location.protocol + "//" + document.domain.toString() + "/index.php/s/" + share.data.token);
            }
        },
        _createPrivateShareLink: function (event) {
            permissions = _.pluck(_.where(event.currentTarget.parentElement.lastChild.children, {'localName': 'input', 'checked': true}), 'name'); // .currentTarget.parentElement.lastChild.children(input)
            setPermissions = 1;

            for (i = 0, l = permissions.length; i < l; i++) {
                switch (permissions[i]) {
                    case "comment":
                        setPermissions += OC.PERMISSION_COMMENT
                        break
                    case "download":
                        setPermissions += OC.PERMISSION_DOWNLOAD
                        break
                    case "upload":
                        setPermissions += OC.PERMISSION_CREATE
                        break
                    case "delete":
                        setPermissions += OC.PERMISSION_DELETE;
                        break
                }
            }
            share_with = event.currentTarget.nextElementSibling.nextElementSibling.value;
            var re = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;
            if (re.test(share_with)) {
                sharedata = event.currentTarget.dataset;
                share = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.itemtype,
                        itemSource: sharedata.itemsource,
                        shareType: sharedata.sharetype,
                        shareWith: share_with, // password
                        expirationDate: '', // date to
                        permissions: setPermissions,
                        itemSourceName: sharedata.itemsourcename
                    },
                    async: false
                }).responseJSON;
                if (share.status === "success") {
                    event.currentTarget.nextElementSibling.innerText = '';
                    $(".under-logo-notifications").find('.share').text(t('files','Shared'));
                    setTimeout(function(){
                        $(".under-logo-notifications").find('.share').text(t('files',''));
                    },5000);
                } else {
                    event.currentTarget.nextElementSibling.innerText = share.data.message;
                }
            } else {
                event.currentTarget.nextElementSibling.innerText = "error with email";
            }
        },
        _showPublicShare: function () {
            $("body").find(".shared-to-user").hide();
            $("body").find(".private-new-share").hide();
            $("body").find(".shared-by-link").show();
            $("body").find(".public-new-share").show();
        },
        _showPrivateShare: function () {
            $("body").find(".shared-to-user").show();
            $("body").find(".private-new-share").show();
            $("body").find(".shared-by-link").hide();
            $("body").find(".public-new-share").hide();
        },
        _closeDialog: function(event) {
        },
        _gSend:function(){
            sharedata = _.findWhere(this.files, {name: this.contextFile});
            linkExists = 0;
            var token = '';
            shareData = $.ajax({
                type: 'GET',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    fetch: 'getItem',
                    itemType: sharedata.type,
                    itemSource: sharedata.id,
                    checkReshare: true,
                    checkShares: true
                },
                async: false
            }).responseJSON.data.shares;
            $.each(shareData, function(i,v){
                if(v.share_with){
                    linkExists = 1;
                } else if(v.token != undefined) {
                    token = v.token;
                }
            });
            if(token == ''){
                token = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.type,
                        itemSource: sharedata.id,
                        shareType: 3,
                        shareWith: '', // password
                        expirationDate: '', // date to
                        permissions: 1,
                        itemSourceName: sharedata.name
                    },
                    async: false
                }).responseJSON.data.token;
            }
            if (token != '') {
                window.open('https://plus.google.com/share?url=' + "http://"+window.location.hostname + '/index.php/s/' + token,'mywindow', 'height=800,width=800');
            }
        },
        _okSend:function(){
            sharedata = _.findWhere(this.files, {name: this.contextFile});
            linkExists = 0;
            var token = '';
            shareData = $.ajax({
                type: 'GET',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    fetch: 'getItem',
                    itemType: sharedata.type,
                    itemSource: sharedata.id,
                    checkReshare: true,
                    checkShares: true
                },
                async: false
            }).responseJSON.data.shares;
            $.each(shareData, function(i,v){
                if(v.share_with){
                    linkExists = 1;
                } else if(v.token != undefined) {
                    token = v.token;
                }
            });
            if(token == ''){
                token = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.type,
                        itemSource: sharedata.id,
                        shareType: 3,
                        shareWith: '', // password
                        expirationDate: '', // date to
                        permissions: 1,
                        itemSourceName: sharedata.name
                    },
                    async: false
                }).responseJSON.data.token;
            }
            if (token != '') {
                window.open('http://www.ok.ru/dk?st.cmd=addShare&st.s=1&st._surl=' + "http://"+window.location.hostname + '/index.php/s/' + token,'mywindow', 'height=800,width=800');
            }
        },
        _twttrSend:function(){
            sharedata = _.findWhere(this.files, {name: this.contextFile});
            linkExists = 0;
            var token = '';
            shareData = $.ajax({
                type: 'GET',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    fetch: 'getItem',
                    itemType: sharedata.type,
                    itemSource: sharedata.id,
                    checkReshare: true,
                    checkShares: true
                },
                async: false
            }).responseJSON.data.shares;
            $.each(shareData, function(i,v){
                if(v.share_with){
                    linkExists = 1;
                } else if(v.token != undefined) {
                    token = v.token;
                }
            });
            if(token == ''){
                token = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.type,
                        itemSource: sharedata.id,
                        shareType: 3,
                        shareWith: '', // password
                        expirationDate: '', // date to
                        permissions: 1,
                        itemSourceName: sharedata.name
                    },
                    async: false
                }).responseJSON.data.token;
            }
            if (token != '') {
                window.open('https://twitter.com/intent/tweet?url=' + "http://"+window.location.hostname + '/index.php/s/' + token,'mywindow', 'height=800,width=800');
            }
        },
        _mailSend: function(){
            sharedata = _.findWhere(this.files, {name: this.contextFile});
            linkExists = 0;
            var token = '';
            shareData = $.ajax({
                type: 'GET',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    fetch: 'getItem',
                    itemType: sharedata.type,
                    itemSource: sharedata.id,
                    checkReshare: true,
                    checkShares: true
                },
                async: false
            }).responseJSON.data.shares;
            $.each(shareData, function(i,v){
                if(v.share_with){
                    linkExists = 1;
                } else if(v.token != undefined) {
                    token = v.token;
                }
            });
            if(token == ''){
                token = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.type,
                        itemSource: sharedata.id,
                        shareType: 3,
                        shareWith: '', // password
                        expirationDate: '', // date to
                        permissions: 1,
                        itemSourceName: sharedata.name
                    },
                    async: false
                }).responseJSON.data.token;
            }
            if (token != '') {
                popupShow('Отправить через email','<input type="email" val="" id="sendEmail" name="email">');
                $('.popup-ok').one('click touchstart', function(){
                    var shareImage = $.ajax({
                        type: 'GET',
                        url: OC.filePath('files', 'ajax', 'sendMail.php'),
                        data: {
                            mail: $("#sendEmail").val(),
                            token: token,
                        },
                        async: false
                    }).responseJSON;
                });
            }
        },
        _vkSend:function(){
            sharedata = _.findWhere(this.files, {name: this.contextFile});
            linkExists = 0;
            var token = '';
            shareData = $.ajax({
                type: 'GET',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    fetch: 'getItem',
                    itemType: sharedata.type,
                    itemSource: sharedata.id,
                    checkReshare: true,
                    checkShares: true
                },
                async: false
            }).responseJSON.data.shares;
            $.each(shareData, function(i,v){
                if(v.share_with){
                    linkExists = 1;
                } else if(v.token != undefined) {
                    token = v.token;
                }
            });
            if(token == ''){
                token = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.type,
                        itemSource: sharedata.id,
                        shareType: 3,
                        shareWith: '', // password
                        expirationDate: '', // date to
                        permissions: 1,
                        itemSourceName: sharedata.name
                    },
                    async: false
                }).responseJSON.data.token;
            }
            if (token != '') {
                var shareImage = $.ajax({
                    type: 'GET',
                    url: OC.filePath('files', 'ajax', 'socialShare.php'),
                    data: {
                        token: token,
                    },
                    async: false
                }).responseJSON;

                window.open('https://vk.com/share.php?url=' + "http://"+window.location.hostname + '/index.php/s/' + token+ '&image=' + shareImage.link,'mywindow', 'height=800,width=800');

            }
        },
        _fbSend:function(){
            sharedata = _.findWhere(this.files, {name: this.contextFile});
            linkExists = 0;
            var token = '';
            shareData = $.ajax({
                type: 'GET',
                url: OC.filePath('core', 'ajax', 'share.php'),
                data: {
                    fetch: 'getItem',
                    itemType: sharedata.type,
                    itemSource: sharedata.id,
                    checkReshare: true,
                    checkShares: true
                },
                async: false
            }).responseJSON.data.shares;
            $.each(shareData, function(i,v){
                if(v.share_with){
                    linkExists = 1;
                } else if(v.token != undefined) {
                    token = v.token;
                }
            });
            if(token == '') {
                token = $.ajax({
                    type: 'POST',
                    url: OC.filePath('core', 'ajax', 'share.php'),
                    data: {
                        action: "share",
                        itemType: sharedata.type,
                        itemSource: sharedata.id,
                        shareType: 3,
                        shareWith: '', // password
                        expirationDate: '', // date to
                        permissions: 1,
                        itemSourceName: sharedata.name
                    },
                    async: false
                }).responseJSON.data.token;
            }
            if (token != '') {
                var shareImage = $.ajax({
                    type: 'GET',
                    url: OC.filePath('files', 'ajax', 'socialShare.php'),
                    data: {
                        token: token,
                    },
                    async: false
                }).responseJSON;

                FB.ui({
                    method: 'share',
                    href: window.location.hostname + '/index.php/s/' +  token
                }, function (response) {
                });
            }
        },
        _controlProperties: function (event) {
            var currentDirectory = this.currentFolder,
                qtyOfSelectedFiles = this.getSelectedFiles().length,
                path = this.getCurrentDirectory(),
                allFiles = this.files.concat(OC.Search.lastResults);
            //global blocks
            var fullInfo = $('<div class="fullinfo">'),
                filePreviewName = $('<div class="file-preview-name">'),
                filePreview = $('<div class="file-preview">'),
                fileName = $('<div class="file-name">'),
                fileActions = $('<div class="file-actions">'),
                fileAccess = $('<div class="file-access">'),
                fileTags = $('<div class="file-tags">'),
                fileProperties = $('<div class="file-properties">'),
                blockTitle = $('<span class="block-title">'),
                blockSwitcher = $('<div class="block-switcher">'),
                blockContainer = $('<div class="blockContainer">'),
                personalAccess = $('<div class="personal-access">'),
                publicAccess = $('<div class="collective-access">'),
                settingsButton = $('<span class="share-settings">'),
                addTag = $('<span class="addNewTag">');

            if( qtyOfSelectedFiles === 0){
                var information = currentDirectory.info,
                    tagsData = currentDirectory.tags,
                    name = currentDirectory.info.name;
                information.sharesQty = currentDirectory.sharesQty;
                share_visits = (information.share_visits)? information.share_visits : 0;
                var sharesQty = 0;
                if(information.sharesQty.length && information.sharesQty[0].shares && information.sharesQty[0].share_type == '0'){
                    sharesQty = information.sharesQty[0].shares;
                }

                // element name
                if(path === '/' || currentDirectory.path === 'files'){
                    // if folder is MyDisk
                    filePreviewName.addClass('my-disk-info').attr('data-id', information.fileid);
                    filePreview.html('<img src="'+OC.filePath('core', 'img', 'disk-ico.svg')+'">');
                    fileName.text(t("files", "My disk"));
                } else {
                    // folder
                    filePreviewName.attr('data-id', information.fileid);
                    if(currentDirectory.sharesQty.length){
                        filePreview.html('<div class="folder-preview shared">');
                    } else {
                        filePreview.html('<div class="folder-preview">');
                    }
                    fileName.text(name);
                }
                filePreviewName.html([filePreview, fileName]);

                //actions
                fileActions.html('<span class="create-folder">' +
                    '<img src="'+OC.filePath('core', 'img', 'create-folder-ico.png')+'" title="'+t('files','Create folder')+'">' +
                    '</span>' +
                    '<span class="upload-file">' +
                    '<img src="'+OC.filePath('core', 'img', 'upload-ico.png')+'" title="'+t('files','Upload file')+'">' +
                    '</span>' +
                    '<span class="upload-folder">' +
                    '<img src="'+OC.filePath('core', 'img', 'upload-folder-ico.png')+'" title="'+t('files','Upload folder')+'">' +
                    '</span>'
                );



                //access
                if(path === '/'){
                    fileAccess = '';
                } else {
                    blockTitle.text(t('files', 'Folder access'));
                    personalAccess.html('<span class="access-name">'+t('files', 'Private')+':</span><span class="access-qty">'+sharesQty+' '+t('files','people')+'</span>');
                    publicAccess.html('<span class="access-name">'+t('files', 'Public')+':</span><span class="access-qty">'+share_visits+' '+t('files','people')+'</span>');
                    settingsButton.text(t('files', 'Configure'));
                    settingsButton = $('<div class="share-settings-wrp">').html(settingsButton);
                    blockContainer.html([blockSwitcher,personalAccess,publicAccess,settingsButton]);
                    fileAccess.html([blockSwitcher, blockTitle, blockContainer]);
                }

                //tags
                if(path === '/'){
                    fileTags = '';
                } else {
                    blockSwitcher = blockSwitcher.clone();
                    blockTitle = blockTitle.clone().text(t('files', 'Tags'));
                    blockContainer = blockContainer.clone().empty();
                    addTag.text(t('files', 'Add tag'));
                    addTag = $('<div class="add-tag-wrp">').append(addTag);
                    if(tagsData){
                        _.each(tagsData, function(tag){
                            blockContainer.append('<span class="file-tag" data-tag="'+tag+'"><span class="file-tagname">'+tag+'</span><span class="action-delTag" data-action="delTag"></span></span>');
                        });
                    }
                    blockContainer.append(addTag);
                    fileTags.html([blockSwitcher,blockTitle,blockContainer]);
                    fileTags.attr('data-tags',(tagsData !== undefined)?tagsData.toString(): '');
                }

                //properties
                if(fileProperties){
                    blockSwitcher = blockSwitcher.clone();
                    blockTitle = blockTitle.clone().text(t('files', 'Properties'));
                    blockContainer = blockContainer.clone().empty();
                    var props = {
                        'Creation date' : (information.create_date != '-') ? formatDate(information.create_date*1000) : '-',
                        'Upload date' : formatDate(information.mtime*1000),
                        'Type': 'Folder',
                        'Size': OC.Util.humanFileSize(information.size)
                    };
                    _.each(props, function(value, name){
                        blockContainer.append('<div class="property-item"><span class="property-name">'+t('files', name)+':</span><span class="property-value">'+t('files', value)+'</span></div>');
                    });
                    fileProperties.html([blockSwitcher, blockTitle, blockContainer]);
                }
                fullInfo.html([filePreviewName, fileActions, fileAccess, fileTags, fileProperties]);
            }
            if( qtyOfSelectedFiles === 1 ){
                var currentFile = _.first(_.where(allFiles, {id: ''+this.getSelectedFiles()[0].id}));
                if(currentFile == undefined){
                    var currentFile = _.first(_.where(allFiles, {id: this.getSelectedFiles()[0].id}));
                }
                var information = currentFile,
                    tagsData = currentFile.tags,
                    name = information.name,
                    type = information.type,
                    etag = information.etag,
                    share_visits = (information.share_visits)? information.share_visits : 0;
                var sharesQty = 0;
                if(information.sharesQty.length && information.sharesQty[0].shares && information.sharesQty[0].share_type == '0'){
                    sharesQty = information.sharesQty[0].shares;
                }
                fullInfo.attr('data-path', information.fullPath.replace('//', '/'));

                // element name
                // folder
                if(type === 'dir') {
                    if(information.sharesQty.length){
                        filePreview.html('<div class="folder-preview shared">');
                    } else {
                        filePreview.html('<div class="folder-preview">');
                    }
                } else {
                    var h = 48;
                    var url = OC.generateUrl('/core/preview.png?') + "file=" + (this.getCurrentDirectory() + '/' + name).replace('//', '/') + "&c=" + etag + "&y="+h;
                    filePreview.html('<img src="'+url+'">');
                }
                filePreviewName.attr('data-id', information.fileid);
                fileName.text(name);
                filePreviewName.html([filePreview, fileName]);


                //actions
                if(type === 'dir') {
                    //hide file actions from controls
                    $('.actions-selected .print, .actions-selected .hidden-sharing-list').hide();
                    var move = (information.mountType != undefined && information.mountType == 'shared-root') ? '' :
                    '<span class="move">' +
                    '<img src="'+OC.filePath('core', 'img', 'move-ico.png')+'" title="'+t('files','Move')+'">' +
                    '</span>';
                    fileActions.html('<span class="download">' +
                        '<img src="'+OC.filePath('core', 'img', 'upload-file-ico.png')+'" title="'+t('files','Download')+'">' +
                        '</span>' +
                        move +
                        '<span class="copy">' +
                        '<img src="'+OC.filePath('core', 'img', 'copy-ico.png')+'" title="'+t('files','Copy')+'">' +
                        '</span>' +
                        '<span class="delete-selected">' +
                        '<img src="'+OC.filePath('core', 'img', 'remove-ico.png')+'" title="'+t('files','Remove')+'">' +
                        '</span>'
                    );
                } else {
                    //hide file actions from controls
                    $('.actions-selected .print, .actions-selected .hidden-sharing-list').show();
                    var move = (information.mountType != undefined && information.mountType == 'shared-root') ? '' :
                    '<span class="move">' +
                    '<img src="'+OC.filePath('core', 'img', 'move-ico.png')+'" title="'+t('files','Move')+'">' +
                    '</span>';

                    fileActions.html('<span class="download">' +
                        '<img src="'+OC.filePath('core', 'img', 'upload-file-ico.png')+'" title="'+t('files','Download')+'">' +
                        '</span>' +
                        move +
                        '<span class="copy">' +
                        '<img src="'+OC.filePath('core', 'img', 'copy-ico.png')+'" title="'+t('files','Copy')+'">' +
                        '</span>' +
                        '<span class="print">' +
                        '<img src="'+OC.filePath('core', 'img', 'print-ico.png')+'" title="'+t('files','Print')+'">' +
                        '</span>' +
                        '<span class="delete-selected">' +
                        '<img src="'+OC.filePath('core', 'img', 'remove-ico.png')+'" title="'+t('files','Remove')+'">' +
                        '</span>' +
                        '<span class="hidden-sharing-list">' +
                        '<img src="'+OC.filePath('core', 'img', 'sharing-list-btn-ico.png')+'" title="'+t('files','Sharing')+'">' +
                        '<span class="sharing-span-list-share"></span>' +
                        '</span>'
                    );
                }

                //access
                if(type === 'dir') {
                    blockTitle.text(t('files', 'Folder access'));
                } else {
                    blockTitle.text(t('files', 'File access'));
                }

                if (sharesQty >= 5 && sharesQty <= 19 || sharesQty % 10  >= 5 && sharesQty % 10 <= 9 || 0) {
                    var sharesPeople = t('files','people');
                } else if(sharesQty % 10  == 1 ){
                    var sharesPeople = t('files','people');
                }else if(sharesQty == 0){
                    var sharesPeople = t('files','people');
                }else if(sharesQty >= 2 || sharesQty <= 4){
                    var sharesPeople = t('files','peoples');
                }

                if (share_visits >= 5 && share_visits <= 19 || share_visits % 10  >= 5 && share_visits % 10 <= 9 || 0) {
                    var share_people = t('files','people');
                } else if(share_visits % 10  == 1 ){
                    var share_people = t('files','people');
                }else if(share_visits == 0){
                    var share_people = t('files','people');
                }else if(share_visits >= 2 || share_visits <= 4){
                    var share_people = t('files','peoples');
                }

                personalAccess.html('<span class="access-name">'+t('files', 'Private')+':</span><span class="access-qty"> '+sharesQty+' '+sharesPeople+'</span>');
                publicAccess.html('<span class="access-name">'+t('files', 'Public')+':</span><span class="access-qty"> '+share_visits+' '+share_people+'</span>');
                settingsButton.text(t('files', 'Configure'));
                settingsButton = $('<div class="share-settings-wrp">').html(settingsButton);
                blockContainer.html([blockSwitcher,personalAccess,publicAccess,settingsButton]);
                fileAccess.html([blockSwitcher, blockTitle, blockContainer]);

                //tags
                blockSwitcher = blockSwitcher.clone();
                blockTitle = blockTitle.clone().text(t('files', 'Tags'));
                blockContainer = blockContainer.clone().empty();
                addTag.text(t('files', 'Add tag'));
                addTag = $('<div class="add-tag-wrp">').append(addTag);
                if(tagsData){
                    _.each(tagsData, function(tag){
                        blockContainer.append('<span class="file-tag" data-tag="'+tag+'"><span class="file-tagname">'+tag+'</span><span class="action-delTag" data-action="delTag"></span></span>');
                    });
                }
                blockContainer.append(addTag);
                fileTags.html([blockSwitcher,blockTitle,blockContainer]);
                fileTags.attr('data-tags',(tagsData !== undefined)?tagsData.toString(): '');

                //properties
                if(fileProperties){
                    blockSwitcher = blockSwitcher.clone();
                    blockTitle = blockTitle.clone().text(t('files', 'Properties'));
                    blockContainer = blockContainer.clone().empty();
                    var elementType;
                    var props = {};
                    if(type === 'dir') {
                        props = {
                            'Creation date' :  (information.create_date != '-') ? formatDate(information.create_date*1000) : '-',
                            'Change date' : OC.Util.formatDate(information.mtime),
                            'Type': t('files', 'Folder'),
                            'Size': OC.Util.humanFileSize(information.size)
                        };
                    } else {
                        props = {
                            'Creation date' : (information.create_date != '-') ? formatDate(information.create_date*1000) : '-',
                            'Upload Date' : OC.Util.formatDate(information.storage_mtime*1000),
                            'Type': t('files', 'Image')+' '+information.extension.toUpperCase(),
                            'Resolution': information.resolution_w+'x'+information.resolution_h,
                            'Size': OC.Util.humanFileSize(information.size)
                        };
                    }
                    _.each(props, function(value, name){
                        blockContainer.append('<div class="property-item"><span class="property-name">'+t('files', name)+':</span><span class="property-value">'+value+'</span></div>');
                    });
                    fileProperties.html([blockSwitcher, blockTitle, blockContainer]);
                }
                fullInfo.html([filePreviewName, fileActions, fileAccess, fileTags, fileProperties]);
            }
            if(qtyOfSelectedFiles >  1) {
                var self = this;
                var currentFilesIds = _.pluck(this.getSelectedFiles(), 'id');
                var currentFiles = _.filter(allFiles, function (file) {
                    if (currentFilesIds.indexOf(+file.id) !== -1) {
                        return file;
                    }
                });

                var types = _.without(_.uniq(_.pluck(currentFiles, 'type')), null);
                var commonType = '';
                if (types.length > 1) {
                    commonType = 'element';
                } else if (types.length == 1 && types[0] === 'dir') {
                    commonType = 'folder';
                } else if (types.length == 1 && types[0] === 'file') {
                    commonType = 'file';
                }

                var qty_selected_message = 'Selected: %n ' + commonType;
                var name = n('files', qty_selected_message, qty_selected_message + 's', qtyOfSelectedFiles + '');
                var filesize = _.pluck(currentFiles, 'size').reduce(function (a, b) {
                    return (+a) + (+b);
                });
                if ((_.uniq(_.pluck(currentFiles, 'create_date')).length > 1)) {
                    var createDate = t('files', 'Different');
                } else {
                    var createDate = (_.pluck(currentFiles, 'create_date')[0] != '-') ? formatDate(_.pluck(currentFiles, 'create_date')[0] * 1000) : '-';
                }
                var updateDate = (_.uniq(_.pluck(currentFiles, 'mtime')).length > 1) ? t('files', 'Different') : formatDate(_.pluck(currentFiles, 'mtime')[0]);


                var tagsData = [];
                _.each(currentFilesIds, function (data) {
                    tagsData = tagsData.concat(_.findWhere(allFiles, {id: '' + data}).tags);
                });
                tagsData = _.uniq(tagsData);
                if (tagsData) {
                    _.each(tagsData, function (tag) {
                        blockContainer.append('<span class="file-tag" data-tag="' + tag + '"><span class="file-tagname">' + tag + '</span><span class="action-delTag" data-action="delTag"></span></span>');
                    });
                }

                // element name
                // folder
                filePreview.addClass('several').text(currentFilesIds.length);
                fileName.text(name);
                filePreviewName.html([filePreview, fileName]);

                //actions
                if (types.length > 1) {
                    //hide file actions from controls
                    $('.actions-selected .print, .actions-selected .hidden-sharing-list').hide();
                    fileActions.html('<span class="download">' +
                        '<img src="' + OC.filePath('core', 'img', 'upload-file-ico.png') + '" title="' + t('files', 'Download') + '">' +
                        '</span>' +
                        '<span class="move">' +
                        '<img src="' + OC.filePath('core', 'img', 'move-ico.png') + '" title="' + t('files', 'Move') + '">' +
                        '</span>' +
                        '<span class="copy">' +
                        '<img src="' + OC.filePath('core', 'img', 'copy-ico.png') + '" title="' + t('files', 'Copy') + '">' +
                        '</span>' +
                        '<span class="delete-selected">' +
                        '<img src="' + OC.filePath('core', 'img', 'remove-ico.png') + '" title="' + t('files', 'Remove') + '">' +
                        '</span>'
                    );
                } else if(types.length == 1 && types[0] === 'dir'){
                    //hide file actions from controls
                    $('.actions-selected .print, .actions-selected .hidden-sharing-list').hide();
                    fileActions.html('<span class="download">' +
                        '<img src="' + OC.filePath('core', 'img', 'upload-file-ico.png') + '" title="' + t('files', 'Download') + '">' +
                        '</span>' +
                        '<span class="move">' +
                        '<img src="' + OC.filePath('core', 'img', 'move-ico.png') + '" title="' + t('files', 'Move') + '">' +
                        '</span>' +
                        '<span class="copy">' +
                        '<img src="' + OC.filePath('core', 'img', 'copy-ico.png') + '" title="' + t('files', 'Copy') + '">' +
                        '</span>' +
                        '<span class="delete-selected">' +
                        '<img src="' + OC.filePath('core', 'img', 'remove-ico.png') + '" title="' + t('files', 'Remove') + '">' +
                        '</span>'
                    );
                } else if (types.length == 1 && types[0] === 'file'){
                    //hide file actions from controls
                    $('.actions-selected .print, .actions-selected .hidden-sharing-list').show();
                    fileActions.html('<span class="download">' +
                        '<img src="'+OC.filePath('core', 'img', 'upload-file-ico.png')+'" title="'+t('files','Download')+'">' +
                        '</span>' +
                        '<span class="move">' +
                        '<img src="'+OC.filePath('core', 'img', 'move-ico.png')+'" title="'+t('files','Move')+'">' +
                        '</span>' +
                        '<span class="copy">' +
                        '<img src="'+OC.filePath('core', 'img', 'copy-ico.png')+'" title="'+t('files','Copy')+'">' +
                        '</span>' +
                            // '<span class="print">' +
                            // '<img src="'+OC.filePath('core', 'img', 'print-ico.png')+'" title="'+t('files','Print')+'">' +
                            // '</span>' +
                        '<span class="delete-selected">' +
                        '<img src="'+OC.filePath('core', 'img', 'remove-ico.png')+'" title="'+t('files','Remove')+'">' +
                        '</span>' +
                        '<span class="hidden-sharing-list">' +
                        '<img src="'+OC.filePath('core', 'img', 'sharing-list-btn-ico.png')+'" title="'+t('files','Sharing')+'">' +
                        '</span>'
                    );
                    //hide file actions from controls
                    $('.actions-selected .print').hide();
                }


                //access
                if(types.length > 1){
                    blockTitle.text(t('files', 'Elements access'));
                } else if(types.length == 1 && types[0] === 'dir') {
                    blockTitle.text(t('files', 'Folders access'));
                } else if(types.length == 1 && types[0] === 'file'){
                    blockTitle.text(t('files', 'Files access'));
                }

                var privateShareQty = 0;
                var publicShareQtyVisits = 0;
                currentFiles.forEach(function(file) {
                    publicShareQtyVisits = publicShareQtyVisits + parseFloat(file.share_visits);

                    file.sharesQty.forEach(function(fileShare) {
                        if (fileShare.share_type == 0){
                            privateShareQty = privateShareQty + parseFloat(fileShare.shares);
                        } /*else if (fileShare.share_type == 3){
                         publicShareQtyVisits = publicShareQtyVisits + parseFloat(fileShare.shares);
                         }*/
                    });
                });

                if (privateShareQty >= 5 && privateShareQty <= 19 || privateShareQty % 10  >= 5 && privateShareQty % 10 <= 9 || 0) {
                    var privateSharePeople = t('files','people');
                } else if(privateShareQty % 10  == 1 ){
                    var privateSharePeople = t('files','people');
                }else if(privateShareQty == 0){
                    var privateSharePeople = t('files','people');
                }else if(privateShareQty >= 2 || privateShareQty <= 4){
                    var privateSharePeople = t('files','peoples');
                }

                if (publicShareQtyVisits >= 5 && publicShareQtyVisits <= 19 || publicShareQtyVisits % 10  >= 5 && publicShareQtyVisits % 10 <= 9 || 0) {
                    var publicSharePeople = t('files','people');
                } else if(publicShareQtyVisits % 10  == 1 ){
                    var publicSharePeople = t('files','people');
                }else if(publicShareQtyVisits == 0){
                    var publicSharePeople = t('files','people');
                }else if(publicShareQtyVisits >= 2 || publicShareQtyVisits <= 4){
                    var publicSharePeople = t('files','peoples');
                }

                personalAccess.html('<span class="access-name">'+t('files', 'Private')+':</span><span class="access-qty"> '+privateShareQty+' '+privateSharePeople+'</span>');
                publicAccess.html('<span class="access-name">'+t('files', 'Public')+':</span><span class="access-qty"> '+publicShareQtyVisits+' '+publicSharePeople+'</span>');
                settingsButton.text(t('files', 'Configure'));
                settingsButton = $('<div class="share-settings-wrp">').html(settingsButton);
                blockContainer.html([blockSwitcher,personalAccess,publicAccess,settingsButton]);
                fileAccess.html([blockSwitcher, blockTitle, blockContainer]);

                //tags
                blockSwitcher = blockSwitcher.clone();
                blockTitle = blockTitle.clone().text(t('files', 'Tags'));
                blockContainer = blockContainer.clone().empty();
                addTag.text(t('files', 'Add tag'));
                addTag = $('<div class="add-tag-wrp">').append(addTag);
                if(tagsData){
                    _.each(tagsData, function(tag){
                        blockContainer.append('<span class="file-tag" data-tag="'+tag+'"><span class="file-tagname">'+tag+'</span><span class="action-delTag" data-action="delTag"></span></span>');
                    });
                }
                blockContainer.append(addTag);
                fileTags.html([blockSwitcher,blockTitle,blockContainer]);
                fileTags.attr('data-tags',(tagsData !== undefined)?tagsData.toString(): '');

                //properties
                if(fileProperties){
                    var displayType = '';
                    if(types.length > 1){
                        displayType = t('files', 'Different');
                    } else if(types.length == 1 && types[0] === 'dir') {
                        displayType = t('files', 'Folders');
                    } else if(types.length == 1 && types[0] === 'file') {
                        displayType = t('files', 'Files');
                    }

                    blockSwitcher = blockSwitcher.clone();
                    blockTitle = blockTitle.clone().text(t('files', 'Properties'));
                    blockContainer = blockContainer.clone().empty();
                    var elementType,
                        props = {};
                    props = {
                        'Creation date' : (createDate != 'invalid date') ? createDate : '-',
                        'Update date' : updateDate,
                        'Type': t('files', displayType),
                        'Size': OC.Util.humanFileSize(filesize)
                    };
                    _.each(props, function(value, name){
                        blockContainer.append('<div class="property-item">' +
                            '<span class="property-name">'+t('files', name)+':</span>' +
                            '<span class="property-value">'+value+'</span>' +
                            '</div>');
                    });
                    fileProperties.html([blockSwitcher, blockTitle, blockContainer]);
                }
                fullInfo.html([filePreviewName, fileActions, fileAccess, fileTags, fileProperties]);

            }
            if(!this.$el.find('#fullInfo .fullinfo').length){
                this.$el.find('#fullInfo').append(fullInfo);
            } else {
                this.$el.find('#fullInfo .fullinfo').replaceWith(fullInfo);
                if($('#app-content').hasClass('toggled')){
                    fullInfo.show();
                }
            }
        },
        _showShareMenuShare:function(){
            console.log('1');
            this._showShareMenu();
            $('.hidden-sharing-list .sub-context').attr('style', 'right: -233px; top: 66px; display: block;');
            console.log('2');
        },
        _showShareMenu:function(){
            //Share
            var block = $('div.hidden-sharing-list');
            var ext = "-ico.png";
            var subMenus = {
                'vkontakte': 'To send through',
                'facebook': 'To send through',
                'ok': 'To send through',
                'twitter': 'To send through',
                'g-plus': 'To send through',
                'mail': 'To send through'
            };
            function renderSubmenu(subMenus) {
                if (typeof subMenus === 'undefined') {
                    return '';
                }
                var sub_html = '<div class="sub-context"><ul>';
                for (var sub_name in subMenus) {
                    sub_html += '<li>' +
                        '<span id="' + sub_name + '">' +
                        t('files', subMenus[sub_name]) + '<img src = "' + OC.imagePath('core', sub_name + ext) + '" > ' +
                        ' </span>' +
                        '</li> ';
                }
                sub_html += '</ul></div>';
                return sub_html;
            }

            var filelist2 = this;

            var fileLength = this._selectedFiles.length;
            if(fileLength > 1 || fileLength == 0){
                return;
            }

            self = this;
            self.contextId = _.pluck(this._selectedFiles, 'id')[0];
            var file = _.findWhere(self.files.concat(OC.Search.lastResults), {id:self.contextId+''});
            if (file == undefined) file = _.findWhere(self.files.concat(OC.Search.lastResults), {id:parseInt(self.contextId)});
            self.contextFile = file.name;

            //self.contextFile = file.name;

            var filess = this._selectedFiles;

            if($('.sharing-span-list').hasClass('sub')) {
                $('.sharing-span-list').removeClass('sub');
                $('.hidden-sharing-list .sub-context').css('display','none');
            }else {
                $('.sharing-span-list').addClass('sub');
                if(!$('.hidden-sharing-list .sub-context').length){
                    block.append(renderSubmenu(subMenus));
                }
                $('.hidden-sharing-list .sub-context').css('display','block');
            }
            //remove if don't focus
            $('#fileList li').on('click', function () {
                $('.sub-context').fadeOut(200, function () {
                    $(this).remove();
                    $('.sharing-span-list').removeClass('sub');
                });
            });
            $('#app-content-files').on('click', function () {
                $('.sub-context').fadeOut(200, function () {
                    $(this).remove();
                    $('.sharing-span-list').removeClass('sub');
                });
            });
            $(document).on('scroll', function(){
                $('.sub-context').fadeOut(200, function () {
                    $(this).remove();
                    $('.sharing-span-list').removeClass('sub');
                });
            });
        },
        _fullInfoAnimation: function(e) {
            var self = this;
            listView();
            self.$el.find('#fullInfo .fullinfo').show();
            if(!this.getSelectedFiles().length){
                this._controlProperties();
            }
            var fileList = self.$el.find('#fileList'),
                fileActions = self.$el.find('.file-actions-block .file-action-nav'),
                emptyLabel = self.$el.find('.empty-folder-block'),
                fullInfo = self.$el.find('.fullinfo'),
                fullInfoWidth = fullInfo.outerWidth();
            if ($(window).width() < 1000){

                fullInfo.find('.file-actions span img').each(function(){
                    var actionName = $(this).attr('title');
                    $(this).parent().append(actionName);
                });
                fullInfo.find('.file-access .blockContainer').find('.share-settings').text(t('files', 'Access settings'));
                fullInfo.find('.hidden-sharing-list img').attr('src', OC.filePath('core', 'img', 'sharing-ico.png'));
                fullInfo.find('.print, .file-access, .file-tags, .file-properties').hide();
                var access = fullInfo.find('.file-access .blockContainer').html(),
                    properties = fullInfo.find('.file-properties .blockContainer').html(),
                    tags = fullInfo.find('.file-tags .blockContainer').html();
                if (access == undefined) {
                    access = '';
                }
                if (tags == undefined) {
                    tags = '';
                }
                if (properties == undefined) {
                    properties = '';
                }
                //tabs skeleton
                var fullInfoTabs = $('<div class="fullinfo-tabs">' +
                    '<ul class="fullinfo-tab-list clear">' +
                    '<li>'+t('files', 'Properties and access')+'</li>' +
                    '<li>'+t('files', 'Tags')+'</li>' +
                    '</ul>' +
                    '<div class="fullinfo-tab-content">'+access+properties+'</div>' +
                    '<div class="fullinfo-tab-content">' +
                    '<div class="fullinfo-addTag-mobile">' +
                    '<input type="text" id="newTagInput"   placeholder="'+t('files', 'Add tag')+'" class="newTagInput input-ph" value="" autofocus>' +
                    '<div id="addNewTagMobile" class="button">'+t('files', 'Ok')+'</div>' +
                    '</div>' +
                    tags +
                    '</div>' +
                    '</div>');
                var access = fullInfo.find('.file-access .blockContainer');
                fullInfo.append(fullInfoTabs);
                tabs();
                //open mobile info
                if ($('body').hasClass('mobile-fullinfo-opened')) {
                    $('#popup-bgd').fadeOut();

                    fullInfo.fadeOut(350, function () {
                        fullInfo.remove();
                        $('body').removeClass('mobile-fullinfo-opened');
                    });
                } else {
                    $('body').addClass('mobile-fullinfo-opened');
                    $('#popup-bgd').fadeIn();
                    $('#popup-bgd').click(function () {
                        $(this).fadeOut();
                        fullInfo.fadeOut(200, function () {
                            fullInfo.remove();
                            $('#fullinfo-bgd').css('display','none');
                            $('body').removeClass('mobile-fullinfo-opened');
                        });
                    });
                }
            } else {
                if (!fullInfo.is(':animated') && !fileList.is(':animated') && !fileActions.is(':animated')) {
                    if(!(parseFloat(fullInfo.css('right')) === -fullInfoWidth)){
                        fullInfo.css('right', '0px');
                        fullInfo.animate({'right': -fullInfoWidth }, 600,function() {
                            $(this).hide();
                            $('.content-files').removeClass('overflow-hidden');
                        });
                        fileList.animate({'width': '+=' + fullInfoWidth }, 600);
                        fileActions.animate({'width': '+=' + fullInfoWidth }, 600);
                        emptyLabel.animate({'margin-left': '+=' + fullInfoWidth/2}, 600);
                        $('#app-content').toggleClass('toggled');
                    } else {
                        fullInfo.show();
                        $('.content-files').addClass('overflow-hidden');
                        fullInfo.animate({'right': '+=' + fullInfoWidth }, 600);
                        fileList.animate({'width': '-=' + fullInfoWidth }, 600);
                        fileActions.animate({'width': '-=' + fullInfoWidth }, 600);
                        emptyLabel.animate({'margin-left': '-=' + fullInfoWidth/2}, 600);
                        $('#app-content').toggleClass('toggled');
                    }
                }
            }
        },
        fullInfoDestroy: function(e) {
            var self = this;
            $('.fullinfo').remove();
            $('[id="fileList"]').attr('style', '');
            $('.file-actions-block .file-action-nav').attr('style', '');
            $('#app-content').removeClass('toggled');
            $('.content-files').removeClass('overflow-hidden');
        },
        /**
         * Event handler when clicking on a table header
         */
        _onClickHeader: function(e) {
            var $target = $(e.target);
            var sort;
            if (!$target.is('a')) {
                $target = $target.closest('a');
            }
            this._setDirection = ( $target.attr('data-direction') ) ? $target.attr('data-direction') : this._setDirection;
            sort = $target.attr('data-sort');
            if (sort) {
                if (this._sort === sort) {
                    this.setSort(sort, (this._sortDirection === 'desc')?'asc':'desc', true);
                }
                else {
                    if ( sort === 'name' ) {	//sorting of name is opposite to size and mtime
                        this.setSort(sort, 'asc', true);
                    }
                    else {
                        this.setSort(sort, 'desc', true);
                    }
                }
            }
        },
        /**
         * Event handler when clicking on a bread crumb
         */
        _onClickBreadCrumb: function(e) {
            var $el = $(e.target).closest('.crumb'),
                $targetDir = $el.data('dir');
            $targetDirId = $el.data('dirid');

            if ($targetDir !== undefined) {
                e.preventDefault();
                this.changeDirectory($targetDir, true, false, $targetDirId);
            }
            OC.Search.clear();
            //this.updateSearch();
        },

        /**
         * Event handler for when scrolling the list container.
         * This appends/renders the next page of entries when reaching the bottom.
         */
        //_onScroll: function() {
        //    if($(window).scrollTop() + $(window).height() == $(document).height()) {
        //        this._nextPage(true);
        //    }
        //},
        _onClickNext: function() {
            this._nextPage(true);
        },

        /**
         * Event handler when dropping on a breadcrumb
         */
        _onDropOnBreadCrumb: function( event, ui ) {
            var $target = $(event.target);
            if (!$target.is('.crumb')) {
                $target = $target.closest('.crumb');
            }
            var targetPath = $(event.target).data('dir');
            var dir = this.getCurrentDirectory();
            while (dir.substr(0,1) === '/') {//remove extra leading /'s
                dir = dir.substr(1);
            }
            dir = '/' + dir;
            if (dir.substr(-1,1) !== '/') {
                dir = dir + '/';
            }
            // do nothing if dragged on current dir
            if (targetPath === dir || targetPath + '/' === dir) {
                return;
            }

            var files = this.getSelectedFiles();
            if (files.length === 0) {
                // single one selected without checkbox?
                files = _.map(ui.helper.find('li'), this.elementToFile);
            }

            this.move(_.pluck(files, 'name'), targetPath);
        },

        /**
         * Sets a new page title
         */
        setPageTitle: function(title){
            if (title) {
                title += ' - ';
            } else {
                title = '';
            }
            title += this.appName;
            // Sets the page title with the " - ownCloud" suffix as in templates
            window.document.title = title + ' - ' + oc_defaults.title;

            return true;
        },
        /**
         * Returns the tr element for a given file name
         * @param fileName file name
         */
        findFileEl: function(fileName){
            // use filterAttr to avoid escaping issues
            return this.$fileList.find('li').filterAttr('data-file', fileName);
        },

        /**
         * Returns the file data from a given file element.
         * @param $el file tr element
         * @return file data
         */
        elementToFile: function($el){
            $el = $($el);
            return {
                id: parseInt($el.attr('data-id'), 10),
                name: $el.attr('data-file'),
                mimetype: $el.attr('data-mime'),
                mounttype: $el.attr('data-mounttype'),
                type: $el.attr('data-type'),
                size: parseInt($el.attr('data-size'), 10),
                etag: $el.attr('data-etag'),
                permissions: parseInt($el.attr('data-permissions'), 10)
            };
        },

        /**
         * Appends the next page of files into the table
         * @param animate true to animate the new elements
         * @return array of DOM elements of the newly added files
         */
        _folders: function(files){
            if(this.$fileList === null || undefined){
                files = $('#fileList');
            } else {
                files = this.$fileList;
            }
            var dirs = this.files.filter(function(obj){
                return obj.type == 'dir';
            });
            if(!dirs.length){
                dirs = $('#fileList').find('li[data-type="dir"]');
            }
            // fix files grid on not list view
            if($('#filestable.blocks-view').length) {
                if(dirs.length%3 == 0) {
                    files.attr('class', 'threeFolders');
                } else if (dirs.length%3 == 1) {
                    files.attr('class', 'oneFolders');
                } else if (dirs.length%3 == 2) {
                    files.attr('class', 'twoFolders');
                }
            } else if($('#filestable.grid-view').length) {
                if(dirs.length%5 == 0) {
                    files.attr('class', 'threeFolders');
                } else if (dirs.length%5 == 1) {
                    files.attr('class', 'oneFolders');
                } else if (dirs.length%5 == 2) {
                    files.attr('class', 'twoFolders');
                } else if (dirs.length%5 == 3) {
                    files.attr('class', 'fourFolders');
                } else if (dirs.length%5 == 4) {
                    files.attr('class', 'fiveFolders');
                }
            } else if($('#filestable.list-view').length){
                files.attr('class', '');
            }
            // fix files grid on not list view
        },
        _trimmerFileName: function(target, after, wrap){
            target.dotdotdot({
                after: after,
                watch: true,
                wrap: wrap
            });
        },
        _nextPage: function(animate) {
            var nextPageButton = $('<div class="showMore">'+t('files', 'Загрузить еще')+'</div>');
            var index = this.$fileList.children().length,
                count = this.pageSize(),
                hidden,
                tr,
                fileData,
                newTrs = [],
                isAllSelected = this.isAllSelected();

            this._folders();
            if (index >= this.files.length) {
                $('#filestable .lazy-load-loading').fadeOut();
                return false;
            }
            $('#filestable .lazy-load-loading').fadeIn();
            while (count > 0 && index < this.files.length) {
                fileData = this.files[index];
                if (this._filter) {
                    hidden = fileData.name.toLowerCase().indexOf(this._filter.toLowerCase()) === -1;
                } else {
                    hidden = false;
                }
                tr = this._renderRow(fileData, {updateSummary: false, silent: true, hidden: hidden});
                this.$fileList.append(tr);
                if (isAllSelected || this._selectedFiles[fileData.id]) {
                    tr.addClass('selected');
                    tr.find('.selectCheckBox').prop('checked', true);
                }
                if (animate) {
                    tr.addClass('appear transparent');
                }
                newTrs.push(tr);
                index++;

                if(!hidden){
                    count--;
                }

            }

            // trigger event for newly added rows
            if (newTrs.length > 0) {
                this.$fileList.trigger($.Event('fileActionsReady', {fileList: this, $files: newTrs}));
            }

            if (animate) {
                // defer, for animation
                window.setTimeout(function() {
                    for (var i = 0; i < newTrs.length; i++ ) {
                        newTrs[i].removeClass('transparent');
                    }
                }, 0);
            }
            //hide showMore button
            if(index === this.files.length){
                $('#filestable .showMore').hide();
            } else {
                $('#filestable .showMore').show();
            }
            $('#filestable .lazy-load-loading').fadeOut();
            this.$fileList.find('.file').first().css('clear', 'left');

            //trimmer file name
            //this._trimmerFileName(this.$fileList.find('.nametext'), '.files-qty', 'letter');
            return newTrs;
        },

        /**
         * Event handler for when file actions were updated.
         * This will refresh the file actions on the list.
         */
        _onFileActionsUpdated: function() {
            var self = this;
            var $files = this.$fileList.find('li');
            if (!$files.length) {
                return;
            }
            $files.each(function() {
                self.fileActions.display($(this).find('div.filename'), false, self);
            });
            this.$fileList.trigger($.Event('fileActionsReady', {fileList: this, $files: $files}));

        },

        /**
         * Sets the files to be displayed in the list.
         * This operation will re-render the list and update the summary.
         * @param filesArray array of file data (map)
         */
        setFiles: function(filesArray) {
            // detach to make adding multiple rows faster
            this.files = _.uniq(filesArray, 'id');
            this.$fileList.empty();

            // clear "Select all" checkbox
            this.$el.find('.select-all').prop('checked', false);

            this.isEmpty = this.files.length === 0;
            this._nextPage();
            this._folders();

            this.updateEmptyContent();

            this.fileSummary.calculate(filesArray);

            this._selectedFiles = {};
            this._selectionSummary.clear();
            this.updateSelectionSummary();
            $(window).scrollTop(0);
            this.$fileList.trigger(jQuery.Event("updated"));

            //if(this.getPhoto){
            //    this._openImage();
            //}
            // if empty folder
            this._emptyFolder();
            //this._trimmerFileName(this.$fileList.find('.nametext'), '.files-qty', 'letter');

        },
        _emptyFolder: function() {
            if(this.isEmpty) {
                var emptyDecor = '';
                this.$el.find('#fileList').hide();
                if($('#app-content-trashbin').is(':visible')){
                    this.$el.find('.clear-trashbin').hide();
                    emptyDecor = '<div class="empty-folder-block">' +
                        '<div class="empty-folder-icon-block">' +
                        '<img src="'+OC.filePath('core', 'img', 'empty-trash-ico.svg')+'"></div>'+
                        '</div>';
                } else {
                    emptyDecor = '<div class="empty-folder-block">' +
                        '<div class="empty-folder-icon-block"><img src="'+OC.filePath('core', 'img', 'empty-folder-ico.svg')+'"></div>'+
                        '<div class="empty-folder-text-block">' +
                        '<span class="drag-text">'+t('files', 'Drag files here to upload them')+'</span>'+
                        '<span class="upload" onclick="chooseFiles()">'+t('files', 'Upload file')+'</span>'+
                        '</div>'+
                        '</div>';
                }

                if(!this.$el.find('.empty-folder-block').length) {
                    this.$el.find('#filestable').append(emptyDecor);
                }
                this._adaptationTexts();
            } else {
                this.$el.find('#fileList').show();
                if(this.$el.find('.empty-folder-block').length) {
                    if($('#app-content-trashbin').is(':visible')) {
                        this.$el.find('.clear-trashbin').show();
                    }
                    this.$el.find('.empty-folder-block').remove();
                }
            }
        },
        _noResult: function(){
            var noResult = '';
            if($('.empty-folder-block').is(':visible')) {
                $('.empty-folder-block').hide();
                if($(window).width() < 768){
                    $('.control-sort').hide();
                }
            } else {
                $('.control-sort').show();
            }
            this.$el.find('#fileList').hide();
            noResult = '<div class="noresult-folder-block">' +
                '<div class="wrapper">'+
                '<div class="noresult-query">'+
                t('files', 'On request')+' "'+$('#searchbox').val()+'" '+t('files', 'nothing is found')+'.'+
                '</div>'+
                '<div class="noresult-text">'+t('files', 'Try changing the query or the search location')+'</div>'+
                '<img src="'+OC.filePath('core', 'img', 'noresult-folder-ico.svg')+'">' +
                '</div>'+
                '</div>';
            $('.noresult-folder-block').remove();
            $('.showMore').hide();
            this.$el.find('#filestable').append(noResult);
        },
        _adaptationTexts: function() {
            var self = this;
            if ($(window).width() < 999) {
                self.$el.find('.empty-folder-block .drag-text').text(t('files', 'No objects'));
                self.$el.find('.empty-folder-block .upload').text(t('files', 'Upload from the gallery'));
            } else {
                self.$el.find('.empty-folder-block .drag-text').text(t('files', 'Drag files here to upload them'));
                self.$el.find('.empty-folder-block .upload').text(t('files', 'Upload file'));
            }
        },
        /**
         * Creates a new table row element using the given file data.
         * @param {OCA.Files.FileInfo} fileData file info attributes
         * @param options map of attributes
         * @return new tr element (not appended to the table)
         */
        _createRow: function(fileData, options) {
            var td,
                simpleSize,
                basename,
                extension,
                sizeColor,
                icon = OC.filePath('core', 'img', 'loading-ico.png'),
                name = fileData.name,
                type = fileData.type || 'file',
                mtime = parseInt(fileData.mtime, 10),
                mime = fileData.mimetype,
                mimepart = fileData.mimepart,
                path = fileData.path,
                previews = fileData.previews,
                folderPrevs = '',
                prevsLength = '',
                commentsQty = '',
                folderPrevsImgs = '',
                filesQty = fileData.childrenQty,
                spinner = '',
                qtyOfNewComments = fileData.qtyOfNewComments,
                linkUrl;
            options = options || {};

            if (isNaN(mtime)) {
                mtime = new Date().getTime()
            }

            if (type === 'dir') {
                mime = mime || 'httpd/unix-directory';
            }

            if(fileData.mountType === 'trashbin' && fileData.isShareMountPoint){
                name = OC.basename(fileData.fullPath);
            }
            //containing tr
            var tr = $('<li></li>').attr({
                "data-id" : fileData.id,
                "data-type": type,
                "data-size": fileData.size,
                "data-file": name,
                "data-mime": mime,
                "data-mtime": mtime,
                "data-isShare": fileData.isShareMountPoint,
                "data-etag": fileData.etag,
                "data-permissions": fileData.permissions || this.getDirectoryPermissions()
            });
            if (type === 'dir') {
                tr.addClass('folder');

            } else {
                tr.addClass('file');
            }

            if (fileData.mountType) {
                tr.attr('data-mounttype', fileData.mountType);
            }

            if (!_.isUndefined(path)) {
                tr.attr('data-path', path);
            } else {
                path = this.getCurrentDirectory();
            }

            // filename td
            td = $('<div class="filename"></div>');

            //folder build previews
            if (previews){
                previews.map(function(img){
                    folderPrevsImgs  += "<img src='"+img+"'>"
                });
                prevsLength = previews.length;
                if(previews.length > 5) {
                    prevsLength = 5;
                }
            }
            folderPrevs = '<div class="clear folder-previews prews-quant'+prevsLength+'">'+folderPrevsImgs+'</div>';

            //comment quantity of current element
            if(qtyOfNewComments){
                //if comments more than 99
                if(qtyOfNewComments > 99){
                    qtyOfNewComments = 99;
                }
                commentsQty = '<div class="comments">+'+qtyOfNewComments+'</div>';
            }
            spinner = '<div class="spinner"><img class="loading-ico" src="'+OC.filePath('core', 'img', 'loading-ico.png')+'"></div>';

            if (this._allowSelection) {
                td.append(
                    '<input id="select-' + this.id + '-' + fileData.id +
                    '" type="checkbox" class="selectCheckBox"/>' +
                    '<label for="select-' + this.id + '-' + fileData.id + '" class="fileListLabel">' +
                    '<div class="thumbnail">'+spinner+'<img src="" >'+folderPrevs+'</div>' +
                    '<div class="labels-block">'+commentsQty +'</div>'+
                    '</label>'
                );
            } else {
                td.append('<div class="thumbnail"><img src="" ></div>');
            }
            var linkElem = $('<a></a>').addClass("name" );

            // linkUrl
            if (type === 'dir') {
                linkUrl = this.linkTo(path + '/' + name);
            }
            else {
                linkUrl = this.getDownloadUrl(name, path);
            }

            // from here work on the display name
            name = fileData.displayName || name;
            // split extension from filename for non dirs
            if (type !== 'dir'
            //&& name.indexOf('.') !== -1.

            ) {
                basename = name.substr(0, name.lastIndexOf('.'));
                extension = name.substr(name.lastIndexOf('.'));
            } else {
                basename = name;
                basename += " <span class='files-qty'>("+filesQty+")</span>";
                extension = false;
            }
            var nameSpan = $('<span></span>').addClass('nametext');
            var innernameSpan = $('<span></span>').addClass('innernametext').html(basename);
            nameSpan.append(innernameSpan);
            linkElem.append(nameSpan);
            if (extension) {
                nameSpan.append($('<span></span>').addClass('extension').text(extension));
            }

            //if (fileData.extraData) {
            //    if (fileData.extraData.charAt(0) === '/') {
            //        fileData.extraData = fileData.extraData.substr(1);
            //    }
            //    nameSpan.addClass('extra-data').attr('title', fileData.extraData);
            //}
            // dirs can show the number of uploaded files
            if (type === 'dir') {
                linkElem.append($('<span></span>').attr({
                    'class': 'uploadtext',
                    'currentUploads': 0
                }));
            }

            var duration = fileData.duration;
            var hrs = ~~(duration / 3600);
            var mins = ~~((duration % 3600) / 60);
            var secs = duration % 60;
            ret = "";

            if (hrs > 0)
                ret += "" + hrs + ":" + (mins < 10 ? "0" : "");

            ret += "" + mins + ":" + (secs < 10 ? "0" : "");
            ret += "" + secs;
            td.append(linkElem);
            var secondPart = "";
            var firstPart = '';
            if( fileData.mimepart === 'video' ) {
                firstPart = t('files', 'Type')+': <span> '+t("files", "Video")+' '+fileData.extension+'</span>';
                secondPart =  t('files', 'Duration')+': '+ret;
            } else if(fileData.mimepart === 'image') {
                firstPart = '<div class="type">'+t('files', 'Type')+': <span>'+t("files", "Image")+' '+fileData.extension.toUpperCase()+'</span></div>';
                secondPart ='<div class="resolution">'+t('files', 'Resolution')+': <span>'+fileData.resolution_w+"x"+fileData.resolution_h+'</span></div>';
            } else if(fileData.mimepart === 'httpd' || fileData.mimetype === "httpd/unix-directory") {
                firstPart = '';
                fileData.mimepart = '';
                secondPart = "";
            }
            tr.append(td);
            td = $('<div></div>').addClass('detail-data').append(firstPart + secondPart);
            tr.append(td);
            // size column
            if (typeof(fileData.size) !== 'undefined' && fileData.size >= 0) {
                simpleSize = humanFileSize(parseInt(fileData.size, 10), true);
                sizeColor = Math.round(160-Math.pow((fileData.size/(1024*1024)),2));
            } else {
                simpleSize = t('files', 'Pending');
            }

            td = $('<div></div>').addClass('filesize')
                .html("<div class='size'>"+t('files', 'Size')+": <span>"+simpleSize+"</span></div>");
            tr.append(td);

            // date column (1000 milliseconds to seconds, 60 seconds, 60 minutes, 24 hours)
            // difference in days multiplied by 5 - brightest shade for files older than 32 days (160/5)
            var modifiedColor = Math.round(((new Date()).getTime() - mtime )/1000/60/60/24*5 );
            // ensure that the brightest color is still readable
            if (modifiedColor >= '160') {
                modifiedColor = 160;
            }
            var formatted;
            var text;
            if (mtime > 0) {
                formatted = formatDate(mtime);
                text = OC.Util.relativeModifiedDate(mtime);
            } else {
                formatted = t('files', 'Unable to determine date');
                text = '?';
            }
            td = $('<div></div>').attr({ "class": "date" });
            td.append(t('files', 'Edit Date')+': <span>'+formatted+'</span>');
            tr.find('.filesize').prepend(td);
            tr.append("<div></div>");
            return tr;
        },

        /**
         * Adds an entry to the files array and also into the DOM
         * in a sorted manner.
         *
         * @param {OCA.Files.FileInfo} fileData map of file attributes
         * @param {Object} [options] map of attributes
         * @param {boolean} [options.updateSummary] true to update the summary
         * after adding (default), false otherwise. Defaults to true.
         * @param {boolean} [options.silent] true to prevent firing events like "fileActionsReady",
         * defaults to false.
         * @param {boolean} [options.animate] true to animate the thumbnail image after load
         * defaults to true.
         * @return new tr element (not appended to the table)
         */
        add: function(fileData, options) {
            var index = -1;
            var $tr;
            var $rows;
            var $insertionPoint;
            options = _.extend({animate: true}, options || {});

            // there are three situations to cover:
            // 1) insertion point is visible on the current page
            // 2) insertion point is on a not visible page (visible after scrolling)
            // 3) insertion point is at the end of the list

            $rows = this.$fileList.children();

            index = this._findInsertionIndex(fileData);
            if (index > this.files.length) {
                index = this.files.length;
            }
            else {
                $insertionPoint = $rows.eq(index);
            }

            // is the insertion point visible ?
            if ($insertionPoint.length) {
                // only render if it will really be inserted
                $tr = this._renderRow(fileData, options);
                $insertionPoint.before($tr);
            }
            else {
                // if insertion point is after the last visible
                // entry, append
                if (index === $rows.length) {
                    $tr = this._renderRow(fileData, options);
                    this.$fileList.append($tr);
                }
            }

            this.isEmpty = false;
            this.files.splice(index, 0, fileData);

            if ($tr && options.animate) {
                $tr.addClass('appear transparent');
                window.setTimeout(function() {
                    $tr.removeClass('transparent');
                });
            }

            if (options.scrollTo) {
                this.scrollTo(fileData.name);
            }

            // defaults to true if not defined
            if (typeof(options.updateSummary) === 'undefined' || !!options.updateSummary) {
                this.fileSummary.add(fileData, true);
                this.updateEmptyContent();
            }

            return $tr;
        },

        /**
         * Creates a new row element based on the given attributes
         * and returns it.
         *
         * @param {OCA.Files.FileInfo} fileData map of file attributes
         * @param {Object} [options] map of attributes
         * @param {int} [options.index] index at which to insert the element
         * @param {boolean} [options.updateSummary] true to update the summary
         * after adding (default), false otherwise. Defaults to true.
         * @param {boolean} [options.animate] true to animate the thumbnail image after load
         * defaults to true.
         * @return new tr element (not appended to the table)
         */
        _renderRow: function(fileData, options) {
            this.$el.find('#filestable').show();
            if(this.$el.find('.noresult-folder-block').length) {
                this.$el.find('.noresult-folder-block').remove();
                $('.control-sort').show();
            }
            if(this.$el.find('.empty-folder-block').length) {
                this.$el.find('.empty-folder-block').remove();
            }
            options = options || {};
            var type = fileData.type || 'file',
                mime = fileData.mimetype,
                path = fileData.path || this.getCurrentDirectory(),
                permissions = parseInt(fileData.permissions, 10) || 0;

            if (fileData.isShareMountPoint) {
                permissions = permissions | OC.PERMISSION_UPDATE;
            }

            if (type === 'dir') {
                mime = mime || 'httpd/unix-directory';
            }
            var tr = this._createRow(
                fileData,
                options
            );

            var filenameTd = tr.find('div.filename');

            //// TODO: move dragging to FileActions ?
            //// enable drag only for deletable files
            //if (this._dragOptions && permissions & OC.PERMISSION_DELETE) {
            //    filenameTd.draggable(this._dragOptions);
            //}
            //// allow dropping on folders
            //if (this._folderDropOptions && fileData.type === 'dir') {
            //    filenameTd.droppable(this._folderDropOptions);
            //}

            if (options.hidden) {
                tr.addClass('hidden');
            }
            if(fileData.link !== undefined ){
                tr.addClass('search-reasult');
            }

            // display actions
            this.fileActions.display(filenameTd, !options.silent, this);

            //don't take myDisk root, if file is shared
            if(fileData.mountType == 'shared-root'){
                path = '';
            }

            if(fileData.isShareMountPoint === true){
                if (fileData.isPreviewAvailable) {
                    var spinnerDiv = filenameTd.find('.thumbnail .spinner');
                    var icon = filenameTd.find('.thumbnail img');
                    var name = OC.basename(fileData.fullPath);
                    // lazy load / newly inserted td ?
                    this.lazyLoadPreviewShare({
                        path: '/' + name,
                        mime: mime,
                        etag: fileData.etag,
                        callback: function(url) {
                            spinnerDiv.fadeOut("slow", function() {
                                // Animation complete.
                                $(this).remove();
                            });
                            icon.attr('src',  url);
                        }
                    });
                }
            } else {
                if (fileData.isPreviewAvailable) {
                    var spinnerDiv = filenameTd.find('.thumbnail .spinner');
                    var icon = filenameTd.find('.thumbnail img');
                    // lazy load / newly inserted td ?
                    this.lazyLoadPreview({
                        path: path + '/' + fileData.name,
                        mime: mime,
                        etag: fileData.etag,
                        callback: function(url) {
                            spinnerDiv.fadeOut("slow", function() {
                                // Animation complete.
                                $(this).remove();
                            });
                            icon.attr('src',  url);
                        }
                    });
                }
            }


            return tr;
        },
        /**
         * Returns the current directory
         * @method getCurrentDirectory
         * @return current directory
         */
        getCurrentDirectory: function(){
            return this._currentDirectory || this.$el.find('#dir').val() || '/';
        },
        /**
         * Returns the directory permissions
         * @return permission value as integer
         */
        getDirectoryPermissions: function() {
            return parseInt(this.$el.find('#permissions').val(), 10);
        },
        /**
         * @brief Changes the current directory and reload the file list.
         * @param targetDir target directory (non URL encoded)
         * @param changeUrl false if the URL must not be changed (defaults to true)
         * @param {boolean} force set to true to force changing directory
         */
        changeDirectory: function(targetDir, changeUrl, force, targetId) {
            var self = this;
            this.setFilter('');

            var currentDir = this.getCurrentDirectory();

            this._currentDirectoryId = targetId;
            targetDir = targetDir || '/';
            /*if (!force && currentDir === targetDir ) {
             return;
             }*/
            this._setCurrentDir(targetDir, changeUrl, targetId);
            this.reload().then(function(success){
                if (!success) {
                    //self.changeDirectory(currentDir, true);
                    self.changeDirectory(currentDir, true, false, targetId);
                }
            });
        },
        linkTo: function(dir) {
            return OC.linkTo('files', 'index.php')+"?dir="+ encodeURIComponent(dir).replace(/%2F/g, '/');
        },

        changeDirectoryFromTree: function(targetDir, targetId, view, changeUrl, force) {
            var self = this;
            var currentDir = this.getCurrentDirectory();
            targetDir = targetDir || '/';
            /*if (!force && currentDir === targetDir) {
             return;
             }*/

            this._setCurrentDirFromTree(targetDir, targetId, changeUrl, view);
            this.reload().then(function(success){
                if (!success) {
                    self.changeDirectory(currentDir, true, false, targetId);
                }
            });
        },

        /**
         * Sets the current directory name and updates the breadcrumb.
         * @param targetDir directory to display
         * @param changeUrl true to also update the URL, false otherwise (default)
         */
        _setCurrentDir: function(targetDir, changeUrl, targetId) {
            var previousDir = this.getCurrentDirectory(),
                baseDir = OC.basename(targetDir);

            if (baseDir !== '') {
                this.setPageTitle(baseDir);
            }
            else {
                this.setPageTitle();
            }

            this._currentDirectory = targetDir;
            this._currentDirectoryId = targetId;

            // legacy stuff
            this.$el.find('#dir').val(targetDir);

            var url = OC.Util.History.parseUrlQuery();
            var view = (url !== undefined) ? url.view : undefined;
            if(view == 'shared'){
                OCA.Files.App.navigation._activeItem = 'shared';
            }
            if (changeUrl !== false) {
                this.$el.trigger(jQuery.Event('changeDirectory', {
                    dir: targetDir,
                    previousDir: previousDir
                }));
                var url = OC.Util.History.parseUrlQuery();
                url.dir = targetDir;
                if(view != undefined) url.view = view;
                //OC.Util.History.pushState(url);
                //history.replaceState({}, '', '?dir=' + url.dir + ( (view != undefined) ? '&view=' + view : '') );
            }
            this.breadcrumb.setDirectory(this.getCurrentDirectory(), this._currentDirectoryId);
        },

        _setCurrentDirFromTree: function(targetDir, targetId, changeUrl, view) {
            var previousDir = this.getCurrentDirectory(),
                baseDir = OC.basename(targetDir);

            if (baseDir !== '') {
                this.setPageTitle(baseDir);
            }
            else {
                this.setPageTitle();
            }

            this._currentDirectory = targetDir;
            this._currentDirectoryId = targetId;

            // legacy stuff
            this.$el.find('#dir').val(targetDir);

            if (changeUrl !== false) {
                this.$el.trigger(jQuery.Event('changeDirectory', {
                    dir: targetDir,
                    previousDir: previousDir
                    //,
                    //force: false,
                    //dirId: targetId,
                }));
                var url = OC.Util.History.parseUrlQuery();
                if(view == 'shared'){
                    url.view = 'shared';
                    url.dir = targetDir;
                    url.dirId = targetId;
                    //OC.Util.History.pushState(url);
                } else if(view == 'trashbin'){
                    url.view = 'trashbin';
                    url.dir = targetDir;
                    //OC.Util.History.pushState(url);
                } else {
                    delete(url.view);
                    url.dir = targetDir;
                    //OC.Util.History.pushState(url);
                }

            }

            this.breadcrumb.setDirectory(this.getCurrentDirectory(), this._currentDirectoryId);
        },

        /**
         * Sets the current sorting and refreshes the list
         *
         * @param sort sort attribute name
         * @param direction sort direction, one of "asc" or "desc"
         * @param update true to update the list, false otherwise (default)
         */
        setSort: function(sort, direction, update) {
            var comparator = FileList.Comparators[sort] || FileList.Comparators.name;
            this._sort = sort;
            this._sortDirection = (direction === 'desc')?'desc':'asc';
            this._sortComparator = comparator;

            if (direction === 'desc') {
                this._sortComparator = function(fileInfo1, fileInfo2) {
                    return -comparator(fileInfo1, fileInfo2);
                };
            }
            this.$el.find('thead th .sort-indicator')
                .removeClass(this.SORT_INDICATOR_ASC_CLASS)
                .removeClass(this.SORT_INDICATOR_DESC_CLASS)
                .toggleClass('hidden', true)
                .addClass(this.SORT_INDICATOR_DESC_CLASS);

            this.$el.find('thead th.column-' + sort + ' .sort-indicator')
                .removeClass(this.SORT_INDICATOR_ASC_CLASS)
                .removeClass(this.SORT_INDICATOR_DESC_CLASS)
                .toggleClass('hidden', false)
                .addClass(direction === 'desc' ? this.SORT_INDICATOR_DESC_CLASS : this.SORT_INDICATOR_ASC_CLASS);
            if (update) {
                if (this._clientSideSort) {
                    this.files.sort(this._sortComparator);
                    this.setFiles(this.files);
                }
                else {
                    this.reload();
                }
            }
        },

        /**
         * Reloads the file list using ajax call
         *
         * @return ajax call object
         */
        reload: function() {
            var self = this;
            $('.under-logo-notifications').find('.trashbin').text('');
            this.removeSelection();
            this._selectedFiles = {};
            this._selectionSummary.clear();
            this.$el.find('.select-all').prop('checked', false);
            this.showMask();

            if (this._reloadCall) {
                this._reloadCall.abort();
            }

            var currentUrlView;
            var currenturl = OC.Util.History.parseUrlQuery();
            if(currenturl.view == undefined){
                if(currenturl == undefined || currenturl.view == undefined){
                    currentUrlView = ''
                } else {
                    currentUrlView = currenturl.view;
                }
            } else {
                currentUrlView = currenturl.view;
            }
            this._selectedFiles = {};
            this.updateSelectionSummary();

            this._reloadCall = $.ajax({
                url: this.getAjaxUrl('list'),
                data: {
                    dir : this.getCurrentDirectory(),
                    dirId : this._currentDirectoryId,
                    sort: this._sort,
                    sortdirection: this._sortDirection,
                    view: currentUrlView,
                    trashbinAndShare: this.isShare
                }
            });
            var callBack = this.reloadCallback.bind(this);
            return this._reloadCall.then(callBack, callBack);
        },
        reloadCallback: function(result) {
            delete this._reloadCall;
            this.hideMask();
            if (!result || result.status === 'error') {
                // if the error is not related to folder we're trying to load, reload the page to handle logout etc
                if (result.data.error === 'authentication_error' ||
                    result.data.error === 'token_expired' ||
                    result.data.error === 'application_not_enabled'
                ) {
                    OC.redirect(OC.generateUrl('apps/files'));
                }
                OC.Notification.show(result.data.message);
                return false;
            }

            if (result.status === 404) {
                var url = OC.Util.History.parseUrlQuery();
                if(url != undefined && url.view != undefined && url.view == 'shared'){
                    $('body').html(result.responseText);
                    return false;
                }
                // go back home
                this.changeDirectory('/');
                return false;
            }
            // aborted ?
            if (result.status === 0){
                return true;
            }

            // TODO: should rather return upload file size through
            // the files list ajax call
            this.updateStorageStatistics(true);

            if (result.data.permissions) {
                this.setDirectoryPermissions(result.data.permissions);
            }

            //OC.Search.lastResults не очищается после перехода по крошкам. Если перешли - очищается строка поиска. и елементы поиска не добавляются в список.
            if($('#searchbox').val().length > 0){
                result.data.files = result.data.files.concat(OC.Search.lastResults);
            }


            this.setFiles(result.data.files);

            this.currentFolder = result.data.currentFolder;
            this.getFolderTags(result.data.popularTags);
            if($('#fullInfo .fullinfo').length) {
                this._controlProperties();
            }
            (function(){
                $('.comments-gallery, .comments-open-button').remove();
                if(OC.Util.History.parseUrlQuery().view !== 'trashbin'){
                    OCA.GalleryComments.Comments.initFolderComments();
                }
            })();
            return true;
        },

        updateStorageStatistics: function(force) {
            OCA.Files.Files.updateStorageStatistics(this.getCurrentDirectory(), force);
        },

        getAjaxUrl: function(action, params) {
            return OCA.Files.Files.getAjaxUrl(action, params);
        },

        getDownloadUrl: function(files, dir) {
            $('.under-logo-notifications').find('.loading-page').text('');
            return OCA.Files.Files.getDownloadUrl(files, dir || this.getCurrentDirectory());
        },

        /**
         * Generates a preview URL based on the URL space.
         * @param urlSpec attributes for the URL
         * @param {int} urlSpec.x width
         * @param {int} urlSpec.y height
         * @param {String} urlSpec.file path to the file
         * @return preview URL
         */
        generatePreviewUrl: function(urlSpec) {
            urlSpec = urlSpec || {};

            //if (!urlSpec.y) {
            //    urlSpec.y = this.$table.data('preview-y') || 240;
            //}
            urlSpec.y = 240;
            urlSpec.forceIcon = 0;
            return OC.generateUrl('/core/preview.png?') + $.param(urlSpec);
        },

        /**
         * Lazy load a file's preview.
         *
         * @param path path of the file
         * @param mime mime type
         * @param callback callback function to call when the image was loaded
         * @param etag file etag (for caching)
         */
        lazyLoadPreview : function(options) {
            var self = this;
            var path = options.path;
            var mime = options.mime;
            var ready = options.callback;
            var etag = options.etag;
            var previewURL,
                urlSpec = {};

            urlSpec.file = OCA.Files.Files.fixPath(path);

            if (etag){
                // use etag as cache buster
                urlSpec.c = etag;
            } else {
                console.warn('OCA.Files.FileList.lazyLoadPreview(): missing etag argument');
            }

            previewURL = self.generatePreviewUrl(urlSpec);
            previewURL = previewURL.replace('(', '%28');
            previewURL = previewURL.replace(')', '%29');

            // preload image to prevent delay
            // this will make the browser cache the image
            var img = new Image();
            img.onload = function(){
                // if loading the preview image failed (no preview for the mimetype) then img.width will < 5
                if (img.width > 5) {
                    ready(previewURL);
                }
            };
            img.src = previewURL;
        },

        lazyLoadPreviewShare : function(options) {
            var self = this;
            var path = options.path;
            var mime = options.mime;
            var ready = options.callback;
            var etag = options.etag;
            var previewURL,
                urlSpec = {};

            urlSpec.file = OCA.Files.Files.fixPath(path);

            if (etag){
                // use etag as cache buster
                urlSpec.c = etag;
            } else {
                console.warn('OCA.Files.FileList.lazyLoadPreview(): missing etag argument');
            }


            previewURL = OC.generateUrl('/core/preview.png?') + "file=" + path.replace('//', '/') + "&c=" + etag + "&y="+44;

            //previewURL = self.generatePreviewUrl(urlSpec);
            //previewURL = previewURL.replace('(', '%28');
            //previewURL = previewURL.replace(')', '%29');

            // preload image to prevent delay
            // this will make the browser cache the image
            var img = new Image();
            img.onload = function(){
                // if loading the preview image failed (no preview for the mimetype) then img.width will < 5
                if (img.width > 5) {
                    ready(previewURL);
                }
            };
            img.src = previewURL;
        },

        setDirectoryPermissions: function(permissions) {
            var isCreatable = (permissions & OC.PERMISSION_CREATE) !== 0;
            this.$el.find('#permissions').val(permissions);
            this.$el.find('.creatable').toggleClass('hidden', !isCreatable);
            this.$el.find('.notCreatable').toggleClass('hidden', isCreatable);
        },
        getFolderTags: function(listOfPopularTags){
            var popularTags = $('<ul class="list-of-popular-tags scrollbar-inner"></ul>');
            if (listOfPopularTags.length > 0) {
                for (i = 0; i < listOfPopularTags.length; i++) {
                    var listElement = $('<li><span data-tag="'+listOfPopularTags[i]+'">'+listOfPopularTags[i]+'</span></li>');
                    popularTags.append(listElement);
                }
            } else {
                popularTags = $('<span class="no-tags">'+t("files", "In this folder there is no tags")+'</span>');
            }
            if(listOfPopularTags.length >= 50) popularTags.append('<li>...</li>');
            $('.list-of-popular-tags-wrp').html(popularTags);
            if( $('.list-of-popular-tags').height() > 60 ) {
                $('.under-search-tags').append('<span class="more-tags"></span>');
            } else {
                if($('.more-tags').length){
                    $('.more-tags').remove();
                }
            }
        },
        /**
         * Shows/hides action buttons
         *
         * @param show true for enabling, false for disabling
         */
        showActions: function(show){
            this.$el.find('.actions,#file_action_panel').toggleClass('hidden', !show);
            if (show){
                // make sure to display according to permissions
                var permissions = this.getDirectoryPermissions();
                var isCreatable = (permissions & OC.PERMISSION_READ) !== 0;
                this.$el.find('.creatable').toggleClass('hidden', !isCreatable);
                this.$el.find('.notCreatable').toggleClass('hidden', isCreatable);

                // remove old style breadcrumbs (some apps might create them)
                this.$el.find('#controls .crumb').remove();
                // refresh breadcrumbs in case it was replaced by an app
                this.breadcrumb.render();
            }
            else{
                this.$el.find('.creatable, .notCreatable').addClass('hidden');
            }
        },
        /**
         * Enables/disables viewer mode.
         * In viewer mode, apps can embed themselves under the controls bar.
         * In viewer mode, the actions of the file list will be hidden.
         * @param show true for enabling, false for disabling
         */
        setViewerMode: function(show){
            this.showActions(!show);
            this.$el.find('#filestable').toggleClass('hidden', show);
            this.$el.trigger(new $.Event('changeViewerMode', {viewerModeEnabled: show}));
        },
        /**
         * Removes a file entry from the list
         * @param name name of the file to remove
         * @param {Object} [options] map of attributes
         * @param {boolean} [options.updateSummary] true to update the summary
         * after removing, false otherwise. Defaults to true.
         * @return deleted element
         */
        remove: function(name, options){
            options = options || {};
            var fileEl = this.findFileEl(name);
            var index = fileEl.index();
            if (!fileEl.length) {
                return null;
            }
            if (this._selectedFiles[fileEl.data('id')]) {
                // remove from selection first
                this._selectFileEl(fileEl, false);
                this.updateSelectionSummary();
            }
            //if (this._dragOptions && (fileEl.data('permissions') & OC.PERMISSION_DELETE)) {
            //    // file is only draggable when delete permissions are set
            //    fileEl.find('div.filename').draggable('destroy');
            //}
            this.files.splice(index, 1);
            fileEl.remove();
            // TODO: improve performance on batch update
            this.isEmpty = !this.files.length;
            this._emptyFolder();
            if (typeof(options.updateSummary) === 'undefined' || !!options.updateSummary) {
                this.updateEmptyContent();
                this.fileSummary.remove({type: fileEl.attr('data-type'), size: fileEl.attr('data-size')}, true);
            }

            var lastIndex = this.$fileList.children().length;
            // if there are less elements visible than one page
            // but there are still pending elements in the array,
            // then directly append the next page
            if (lastIndex < this.files.length && lastIndex < this.pageSize()) {
                this._nextPage(true);
            }
            return fileEl;
        },
        /**
         * Finds the index of the row before which the given
         * fileData should be inserted, considering the current
         * sorting
         *
         * @param {OCA.Files.FileInfo} fileData file info
         */
        _findInsertionIndex: function(fileData) {
            var index = 0;
            while (index < this.files.length && this._sortComparator(fileData, this.files[index]) > 0) {
                index++;
            }
            return index;
        },
        /**
         * Moves a file to a given target folder.
         *
         * @param fileNames array of file names to move
         * @param targetPath absolute target path
         */
        move: function(fileNames, targetPath) {
            var self = this;
            var dir = this.getCurrentDirectory();
            var target = OC.basename(targetPath);
            if (!_.isArray(fileNames)) {
                fileNames = [fileNames];
            }
            _.each(fileNames, function(fileName) {
                var $tr = self.findFileEl(fileName);
                var $thumbEl = $tr.find('.thumbnail');
                var oldBackgroundImage = $thumbEl.css('background-image');
                $thumbEl.css('background-image', 'url('+ OC.imagePath('core', 'loading.gif') + ')');
                // TODO: improve performance by sending all file names in a single call
                $.post(
                    OC.filePath('files', 'ajax', 'move.php'),
                    {
                        dir: dir,
                        file: fileName,
                        target: targetPath
                    },
                    function(result) {
                        if (result) {
                            if (result.status === 'success') {
                                // if still viewing the same directory
                                if (self.getCurrentDirectory() === dir) {
                                    // recalculate folder size
                                    var oldFile = self.findFileEl(target);
                                    var newFile = self.findFileEl(fileName);
                                    var oldSize = oldFile.data('size');
                                    var newSize = oldSize + newFile.data('size');
                                    oldFile.data('size', newSize);
                                    oldFile.find('div.filesize').text(OC.Util.humanFileSize(newSize));

                                    // TODO: also update entry in FileList.files

                                    self.remove(fileName);
                                }
                            } else {
                                OC.Notification.hide();
                                if (result.status === 'error' && result.data.message) {
                                    OC.Notification.show(result.data.message);
                                }
                                else {
                                    OC.Notification.show(t('files', 'Error moving file.'));
                                }
                                // hide notification after 10 sec
                                setTimeout(function() {
                                    OC.Notification.hide();
                                }, 10000);
                            }
                        } else {
                            OC.dialogs.alert(t('files', 'Error moving file'), t('files', 'Error'));
                        }
                        $thumbEl.css('background-image', oldBackgroundImage);
                    }
                );
            });
        },
        /**
         * Copying a file to a given target folder.
         *
         * @param fileNames array of file names to move
         * @param targetPath absolute target path
         */
        copy: function(fileNames, targetPath) {
            var self = this;
            var dir = this.getCurrentDirectory();
            var target = OC.basename(targetPath);
            if (!_.isArray(fileNames)) {
                fileNames = [fileNames];
            }
            _.each(fileNames, function(fileName) {
                var $tr = self.findFileEl(fileName);
                var $thumbEl = $tr.find('.thumbnail');
                var oldBackgroundImage = $thumbEl.css('background-image');
                $thumbEl.css('background-image', 'url('+ OC.imagePath('core', 'loading.gif') + ')');
                // TODO: improve performance by sending all file names in a single call
                $.post(
                    OC.filePath('files', 'ajax', 'copy.php'),
                    {
                        dir: dir,
                        file: fileName,
                        target: targetPath
                    },
                    function(result) {
                        if (result) {

                            if (result.status === 'success') {
                                // if still viewing the same directory
                                if (self.getCurrentDirectory() === dir) {
                                    // recalculate folder size
                                    var oldFile = self.findFileEl(target);
                                    var newFile = self.findFileEl(fileName);
                                    var oldSize = oldFile.data('size');
                                    var newSize = oldSize + newFile.data('size');
                                    oldFile.data('size', newSize);
                                    oldFile.find('div.filesize').text(OC.Util.humanFileSize(newSize));

                                    // TODO: also update entry in FileList.files

                                    self.remove(fileName);
                                }
                            } else {
                                OC.Notification.hide();
                                if (result.status === 'error' && result.data.message) {
                                    OC.Notification.show(result.data.message);
                                }
                                else {
                                    OC.Notification.show(t('files', 'Error moving file.'));
                                }
                                // hide notification after 10 sec
                                setTimeout(function() {
                                    OC.Notification.hide();
                                }, 10000);
                            }
                        } else {
                            OC.dialogs.alert(t('files', 'Error moving file'), t('files', 'Error'));
                        }
                        $thumbEl.css('background-image', oldBackgroundImage);
                    }
                );
            });

        },

        /**
         * Triggers file rename input field for the given file name.
         * If the user enters a new name, the file will be renamed.
         *
         * @param oldname file name of the file to rename
         */
        rename: function(oldname) {
            var oldFileName = oldname.replace(/\.[0-9a-z]+$/i,'');
            var extension = oldname.replace(oldFileName, '');
            var self = this;
            var tr, td, input, form;
            tr = this.findFileEl(oldname);
            var oldFileInfo = this.files[tr.index()];
            tr.data('renaming',true);
            td = tr.children('div.filename');
            input = $('<input type="text" class="filename"/>').val(oldFileName);
            form = $('<form></form>');
            form.append(input);
            td.children('a.name').hide();
            td.append(form);
            input.focus();
            //preselect input
            var len = input.val().lastIndexOf('.');
            if ( len === -1 ||
                tr.data('type') === 'dir' ) {
                len = input.val().length;
            }
            input.selectRange(0, len);
            var checkInput = function () {
                var filename = input.val();
                if (filename !== oldFileName) {
                    // Files.isFileNameValid(filename) throws an exception itself
                    OCA.Files.Files.isFileNameValid(filename+extension);
                    if (self.inList(filename+extension)) {
                        throw t('files', '{new_name} already exists', {new_name: filename+extension});
                    }
                }
                return true;
            };

            function restore() {
                input.tipsy('hide');
                tr.data('renaming',false);
                form.remove();
                td.children('a.name').show();
            }

            form.submit(function(event) {
                event.stopPropagation();
                event.preventDefault();
                if (input.hasClass('error')) {
                    return;
                }

                try {
                    var newName = input.val();
                    var $thumbEl = tr.find('.thumbnail');
                    input.tipsy('hide');
                    form.remove();

                    if (newName !== oldFileName) {
                        newName += extension;
                        checkInput();
                        // mark as loading (temp element)
                        $thumbEl.css('background-image', 'url('+ OC.imagePath('core', 'loading.gif') + ')');
                        tr.attr('data-file', newName);
                        var basename = newName;
                        if (newName.indexOf('.') > 0 && tr.data('type') !== 'dir') {
                            basename = newName.substr(0, newName.lastIndexOf('.'));
                        }
                        td.find('a.name span.nametext').text(basename);
                        td.children('a.name').show();
                        tr.find('.fileactions, .action').addClass('hidden');

                        $.ajax({
                            url: OC.filePath('files','ajax','rename.php'),
                            data: {
                                dir : tr.attr('data-path') || self.getCurrentDirectory(),
                                newname: newName,
                                file: oldFileName+extension
                            },
                            success: function(result) {
                                var fileInfo;
                                if (!result || result.status === 'error') {
                                    OC.dialogs.alert(result.data.message, t('files', 'Could not rename file'));
                                    fileInfo = oldFileInfo;
                                    if (result.data.code === 'sourcenotfound') {
                                        self.remove(result.data.newname, {updateSummary: true});
                                        return;
                                    }
                                }
                                else {
                                    fileInfo = result.data;
                                }
                                // reinsert row
                                self.files.splice(tr.index(), 1);
                                tr.remove();
                                tr = self.add(fileInfo, {updateSummary: false, silent: true});
                                self.$fileList.trigger($.Event('fileActionsReady', {fileList: self, $files: $(tr)}));
                            }
                        });
                    } else {
                        // add back the old file info when cancelled
                        self.files.splice(tr.index(), 1);
                        tr.remove();
                        tr = self.add(oldFileInfo, {updateSummary: false, silent: true});
                        self.$fileList.trigger($.Event('fileActionsReady', {fileList: self, $files: $(tr)}));
                    }
                } catch (error) {
                    input.attr('title', error);
                    input.tipsy({gravity: 'w', trigger: 'manual'});
                    input.tipsy('show');
                    input.addClass('error');
                }
                return false;
            });
            input.keyup(function(event) {
                // verify filename on typing
                try {
                    checkInput();
                    input.tipsy('hide');
                    input.removeClass('error');
                } catch (error) {
                    input.attr('title', error);
                    input.tipsy({gravity: 'w', trigger: 'manual'});
                    input.tipsy('show');
                    input.addClass('error');
                }
                if (event.keyCode === 27) {
                    restore();
                }
            });
            input.click(function(event) {
                event.stopPropagation();
                event.preventDefault();
            });
            input.blur(function() {
                form.trigger('submit');
            });
        },
        inList:function(file) {
            return this.findFileEl(file).length;
        },
        /**
         * Delete the given files from the given dir
         * @param files file names list (without path)
         * @param dir directory in which to delete the files, defaults to the current
         * directory
         */
        do_undelete: function (files, dir) {
            $(deletefiles).each(function(){
                $('.explorerListItemContent[data-id='+this+']').parent('.explorerListItem').removeClass('hidden');
                $('#fileList > li[data-id='+this+']').removeClass('hidden');
            })

            // dir = dir.slice(0,-1);
            dir = (dir)? dir : this.getCurrentDirectory();
            self = this;
            params = {
                dir: dir
            };
            if (files) {
                params.files = JSON.stringify(files);
            }
            params.redis = true;
            $.post(OC.filePath('files_trashbin', 'ajax', 'undelete.php'), params, function (result) {
                self.reload();
            });

        },
        do_delete: function (files, types, dir) {
            var self = this;
            var params;

            var filesInfo = this.getSelectedFiles();
            deletefiles = [];
            $(filesInfo).each(function(el){
                $('.explorerListItemContent[data-id=' + this.id + ']').parent('.explorerListItem').addClass('hidden');
                $('#fileList > li[data-id=' + this.id + ']').addClass('hidden');
                deletefiles.push(this.id);
            });

            if (files && files.substr) {
                files = [files];
            }
            //if (files) {
            //    for (var i = 0; i < files.length; i++) {
            //        var deleteAction = this.findFileEl(files[i]).children("div.date").children(".action.delete");
            //        deleteAction.removeClass('icon-delete').addClass('icon-loading-small');
            //    }
            //}
            if (files) {
                self.deletedFiles = self.deletedFiles.concat(files);
            } else {
                self.deletedFiles = self.deletedFiles.concat(_.pluck(self.getSelectedFiles(), 'name'));
            }
            self.deletedFiles = _.uniq(self.deletedFiles);


            var type = (types.length > 1) ? 'element' : _.first(types);
            if (type === 'dir') {
                type = 'folder';
            }
            if (type === 'file') {
                type = 'file';
            }
            var qty_deleted_message = "Deleted %n " + type;

            if (self.deletedFiles.length > 0) {
                $("#body-user").find(".under-logo-notifications").find('.trashbin').text("");
                $("#body-user").find(".under-logo-notifications").find('.trashbin').append("<span>" + n('files', qty_deleted_message, qty_deleted_message + 's', self.deletedFiles.length) + "</span>");
                $("#body-user").find(".under-logo-notifications").find('.trashbin').append("<span id='undelete-notifications'>" + t('files', 'Cancel') + "</span>");
            }

            // Finish any existing actions
            if (this.lastAction) {
                this.lastAction();
            }

            params = {
                dir: dir || this.getCurrentDirectory()
            };
            if (files) {
                params.files = JSON.stringify(files);
            }
            else {
                // no files passed, delete all in current dir
                params.allfiles = true;
                // show spinner for all files
                //this.$fileList.find('li>div.delete .action.delete').removeClass('icon-delete').addClass('icon-loading-small');
            }

            var mountType = _.pluck(self.files, 'mountType')[0];
            if (mountType == 'shared-root') {
                var selectedFilesId = _.pluck(self._selectedFiles, 'id');
                params.filesid = selectedFilesId;
                $.post(OC.filePath('files', 'ajax', 'shareDelete.php'),
                    params,
                    function (result) {
                        if (result.status === 'success') {
                            $.each(files, function (index, file) {
                                var fileEl = self.remove(file, {updateSummary: false});
                                fileEl.find('.selectCheckBox').prop('checked', false);
                                fileEl.removeClass('selected');
                                self.fileSummary.remove({
                                    type: fileEl.attr('data-type'),
                                    size: fileEl.attr('data-size')
                                });
                            });
                        }
                    }
                );
            } else {
                $.post(OC.filePath('files', 'ajax', 'delete.php'),
                    params,
                    function (result) {
                        if (result.status === 'success') {
                            if (params.allfiles) {
                                self.setFiles([]);
                            }
                            else {
                                $.each(files, function (index, file) {
                                    var fileEl = self.remove(file, {updateSummary: false});
                                    // FIXME: not sure why we need this after the
                                    // element isn't even in the DOM any more
                                    fileEl.find('.selectCheckBox').prop('checked', false);
                                    fileEl.removeClass('selected');
                                    self.fileSummary.remove({type: fileEl.attr('data-type'), size: fileEl.attr('data-size')});
                                });
                            }
                            // TODO: this info should be returned by the ajax call!
                            self.updateEmptyContent();
                            self.fileSummary.update();
                            self.updateSelectionSummary();
                            self.updateStorageStatistics();
                        } else {
                            if (result.status === 'error' && result.data.message) {
                                OC.Notification.show(result.data.message);
                            }
                            else {
                                OC.Notification.show(t('files', 'Error deleting file.'));
                            }
                            // hide notification after 10 sec
                            setTimeout(function () {
                                OC.Notification.hide();
                            }, 10000);
                            if (params.allfiles) {
                                // reload the page as we don't know what files were deleted
                                // and which ones remain
                                self.reload();
                            }
                            else {
                                $.each(files, function (index, file) {
                                    var deleteAction = self.findFileEl(file).find('.action.delete');
                                    deleteAction.removeClass('icon-loading-small').addClass('icon-delete');
                                });
                            }
                        }
                    });

            }


        },
        /**
         * Creates the file summary section
         */
        _createSummary: function() {
            var $tr = $('#filesSummary');
            return new OCA.Files.FileSummary($tr);
        },
        updateEmptyContent: function() {
            var permissions = this.getDirectoryPermissions();
            var isCreatable = (permissions & OC.PERMISSION_CREATE) !== 0;
            this.$el.find('#emptycontent').toggleClass('hidden', !isCreatable || !this.isEmpty);
            this.$el.find('#filestable thead th').toggleClass('hidden', this.isEmpty);
        },
        /**
         * Shows the loading mask.
         *
         * @see OCA.Files.FileList#hideMask
         */
        showMask: function() {
            // in case one was shown before
            if(this.$el.find('.mask').length){
                return;
            } else {
                this.$fileList.addClass('reload');
                this.$el.find('.empty-folder-block').addClass('reload');
                this.$el.find('.noresult-folder-block').addClass('reload');
                $('.showMore').hide();
                this.$el.append($('<div class="mask transparent">' +
                    '<img class="loading-ico loading-big-ico" src="'+OC.imagePath('core', 'loading-big-ico.png')+'">' +
                    '</div>'));
            }

            var $mask = this.$el.find('.mask');
            if ($mask.exists()) {
                return;
            }

            this.$table.addClass('hidden');
            this.$el.find('#filesSummary').hide();
            $mask = $('<div class="mask transparent">' +
                '<img class="loading-ico loading-big-ico" src="'+OC.imagePath('core', 'loading-big-ico.png')+'">' +
                '</div>');
            this.$el.append($mask);
            $mask.removeClass('transparent');
            $('.under-logo-notifications').find('.loading-page').text(t('files','Loading')+"...").prepend('<img class="loading-ico" src="'+OC.imagePath('core', 'loading-ico.png')+'">');
            $('.main-context').hide();
        },
        /**
         * Hide the loading mask.
         * @see OCA.Files.FileList#showMask
         */
        hideMask: function() {
            this.$el.find('.mask').remove();
            this.$fileList.removeClass('reload');
            this.$el.find('.empty-folder-block').removeClass('reload');
            this.$el.find('.noresult-folder-block').removeClass('reload');
            $('.showMore').hide();
            this.$el.find('#filesSummary').show();
            $('.under-logo-notifications').find('.loading-page').text('');
        },
        scrollTo:function(file) {
            if (!_.isArray(file)) {
                file = [file];
            }
            this.highlightFiles(file, function($tr) {
                $tr.addClass('searchresult');
                $tr.one('hover', function() {
                    $tr.removeClass('searchresult');
                });
            });
        },
        /**
         * @deprecated use setFilter(filter)
         */
        filter:function(query) {
            this.setFilter('');
        },
        /**
         * @deprecated use setFilter('')
         */
        unfilter:function() {
            this.setFilter('');
        },
        /**
         * hide files matching the given filter
         * @param filter
         */
        runSearch: function () {
            var filter = $('#searchbox').val();
            if (filter.length >= 2) {
                this.setFilter(filter);
            } else {
                this.setFilter('')
            }
        },
        showResults: function () {
            var filter = $('#searchbox').val();
            if (filter.length >= 1) {
                this.setFilter(filter);
            } else {
                this.setFilter('')
            }

            //чтобы не двоились запросы и нельзя было подряд одни и те же запросы выполнять
            if(typeof lastFilter == "undefined") lastFilter = '';
            if(lastFilter == this._filter  || this._filter.length == 0){
                lastFilter = this._filter;
                return;
            }
            lastFilter = this._filter;

            $('#ui-id-1').css('display', 'none');

            this.$el.find('.nofilterresults').hide();
            if (this._filter.length < 1) {
                OC.Search.lastResults = []
            } else {
                if (this._filter.length >= 1) {
                    this.setFilter(this._filter);
                    OC.Search.search(this._filter);
                } else {
                    OC.Search.lastResults = [];
                }
                this.fileSummary.setFilter(this._filter, _.sortBy(this.files.concat(OC.Search.lastResults), 'type'));

                var $ids = this.fileSummary.summary.ids;

                this.$el.find('.file-action-nav-left').html(
                    n('files', 'Всего объектов: %n', 'Всего объектов: %n', $ids.length)
                );

                this.hideIrrelevantUIWhenNoFilesMatch($ids, this);

            }

        },
        setFilter: function (filter) {
            var hashTag = false;
            if (filter[0] === '#') {
                filter = filter.substring(1);
                hashTag = true;
            }
            this._filter = filter;
            /*if(this._filter.length < 2 ){
             return;
             }*/
            //todo need create method who create list of local tags
            var tags = [];
            _.each(this.files, function (data) {
                tags = tags.concat(data.tags);
            });
            tags = _.uniq(tags);
            var filesResults = [];
            var tagsResults = [];
            var files = [];
            var results = [];
            if (hashTag) {
                for (i = 0, l = tags.length; i < l; i++) {
                    results.push({
                        desc: 'tag',
                        label: tags[i],
                        value: '#' + tags[i],
                        icon: '#'
                    });
                }
            } else {
                files = _.uniq(this.files, 'name');
                for (i = 0, l = files.length; i < l; i++) {
                    var type = (files[i].type == 'dir') ? t('files', 'Папка') : '';
                    results.push({
                        label: files[i].name,
                        value: files[i].name,
                        desc: files[i].type,
                        icon: t('files', type),
                        path: files[i].fullPath
                    });
                }
                for (i = 0, l = tags.length; i < l; i++) {
                    results.push({
                        desc: 'tag',
                        label: tags[i],
                        value: '#' + tags[i],
                        icon: '#'
                    });
                }
            }
            $("#searchbox").attr('autocomplete', 'off')
            $("#searchbox").autocomplete({
                source: results,
                minLength: 2,
                position: {my: "right top+5", at: "right bottom"}
            }).autocomplete().data("uiAutocomplete")._renderItem = function (ul, item) {
                return $("<li class='" + item.desc + "' data-path='" + ((item.path != undefined) ? item.path : '') + "'>")
                    .append("<a>" + item.icon + " " + item.label + "</a>")
                    .appendTo(ul);
            };
            //$('#ui-id-1'). css('display', 'block');
        },
        hideIrrelevantUIWhenNoFilesMatch:function($ids, $filelist) {
            var $length = $ids.length;
            if (this._filter && $length === 0) {
                this._noResult();
                if($(window).width() < 768){
                    $('.control-sort').hide()
                } else {
                    $('.control-sort').show();
                }
            } else {
                if(!this.isEmpty) {
                    $('.showMore, #fileList').show();
                }
                $('.control-sort').show();
                $('.noresult-folder-block').remove();
                $('#fileList').empty();
                if(!this.files.length) {
                    $('.empty-folder-block').show();
                }

                var popularTags = new Array();
                $.ajax({
                    url: OC.generateUrl('apps/files/ajax/getPopularTagsAfterSearch.php'),
                    async: false,
                    data: {ids: $ids},
                    dataType: 'json',
                    type: 'POST',
                    success: function(response){
                        popularTags = _.pluck(response, 'category');
                    }
                });
                this.getFolderTags(popularTags);
                $('.showMore').hide();

                var index = this.$fileList.children().length,
                    count = this.pageSize();

                var pageLength;
                if($length < count) pageLength = $length;
                else pageLength = count;


                for(i=0;i<pageLength;i++){
                    $('#fileList').append($filelist._renderRow(_.findWhere($filelist.files.concat(OC.Search.lastResults), {id:$ids[i]})));
                }

                if($length > count){
                    $('#filestable .showMore').show();
                }
                this.$fileList.find('.file').first().css('clear', 'left');
            }
        },
        /**
         * get the current filter
         * @param filter
         */
        getFilter:function(filter) {
            return this._filter;
        },
        /**
         * update the search object to use this filelist when filtering
         */
        updateSearch:function() {
            if (OCA.Search.files) {
                OCA.Search.files.setFileList(this);
            }
            if (OC.Search) {
                OC.Search.clear();
            }
        },
        /**
         * Update UI based on the current selection
         */
        updateSelectionSummary: function() {
            if (Object.keys(this._selectedFiles).length === 0) {
                var allObj = this.files.length;
                this.$el.find('.file-action-nav-left').html(
                    n('files', 'Всего объектов: %n', 'Всего объектов: %n', allObj)
                );
            }
            else {
                var summary = this._selectionSummary.summary;
                var canDelete;
                canDelete = (this.getDirectoryPermissions() & OC.PERMISSION_DELETE) && this.isSelectedDeletable();
                var elemsSum = summary.totalDirs + summary.totalFiles;
                var selection = t('files', 'Selected')+': '+n('files', '%n element', '%n elements', elemsSum)+' ' +
                    t('files', 'on')+ ' '+ OC.Util.humanFileSize(summary.totalSize);
                this.$el.find('.file-action-nav-left').html(selection);
                this.$el.find('#modified a>span:first').text('');
                this.$el.find('table').addClass('multiselect');
                this.$el.find('.delete-selected').toggleClass('hidden', !canDelete);
            }
        },

        /**
         * Check whether all selected files are deletable
         */
        isSelectedDeletable: function() {
            return _.reduce(this.getSelectedFiles(), function(deletable, file) {
                return deletable && (file.permissions & OC.PERMISSION_DELETE);
            }, true);
        },

        /**
         * Returns whether all files are selected
         * @return true if all files are selected, false otherwise
         */
        isAllSelected: function() {
            return this.$el.find('.select-all').prop('checked');
        },

        /**
         * Returns the file info of the selected files
         *
         * @return array of file names
         */
        getSelectedFiles: function() {
            return _.values(this._selectedFiles);
        },

        getUniqueName: function(name) {
            if (this.findFileEl(name).exists()) {
                var numMatch;
                var parts=name.split('.');
                var extension = "";
                if (parts.length > 1) {
                    extension=parts.pop();
                }
                var base=parts.join('.');
                numMatch=base.match(/\((\d+)\)/);
                var num=2;
                if (numMatch && numMatch.length>0) {
                    num=parseInt(numMatch[numMatch.length-1], 10)+1;
                    base=base.split('(');
                    base.pop();
                    base=$.trim(base.join('('));
                }
                name=base+' ('+num+')';
                if (extension) {
                    name = name+'.'+extension;
                }
                // FIXME: ugly recursion
                return this.getUniqueName(name);
            }
            return name;
        },

        /**
         * Shows a "permission denied" notification
         */
        _showPermissionDeniedNotification: function() {
            var message = t('core', 'You don’t have permission to upload or create files here');
            OC.Notification.show(message);
            //hide notification after 10 sec
            setTimeout(function() {
                OC.Notification.hide();
            }, 5000);
        },

        /**
         * Setup file upload events related to the file-upload plugin
         */
        setupUploadEvents: function() {
            var self = this;

            // handle upload events
            var fileUploadStart = this.$el.find('#file_upload_start');

            // detect the progress bar resize
            fileUploadStart.on('resized', this._onResize);

            fileUploadStart.on('fileuploaddrop', function(e, data) {
                OC.Upload.log('filelist handle fileuploaddrop', e, data);

                if (self.$el.hasClass('hidden')) {
                    // do not upload to invisible lists
                    return false;
                }

                var dropTarget = $(e.originalEvent.target);
                // check if dropped inside this container and not another one
                if (dropTarget.length
                    && !self.$el.is(dropTarget) // dropped on list directly
                    && !self.$el.has(dropTarget).length // dropped inside list
                    && !dropTarget.is(self.$container) // dropped on main container
                ) {
                    return false;
                }

                // find the closest tr or crumb to use as target
                dropTarget = dropTarget.closest('li, .crumb');

                // if dropping on tr or crumb, drag&drop upload to folder
                if (dropTarget && (dropTarget.data('type') === 'dir' ||
                    dropTarget.hasClass('crumb'))) {

                    // remember as context
                    data.context = dropTarget;

                    // if permissions are specified, only allow if create permission is there
                    var permissions = dropTarget.data('permissions');
                    if (!_.isUndefined(permissions) && (permissions & OC.PERMISSION_CREATE) === 0) {
                        self._showPermissionDeniedNotification();
                        return false;
                    }
                    var dir = dropTarget.data('file');
                    // if from file list, need to prepend parent dir
                    if (dir) {
                        var parentDir = self.getCurrentDirectory();
                        if (parentDir[parentDir.length - 1] !== '/') {
                            parentDir += '/';
                        }
                        dir = parentDir + dir;
                    }
                    else{
                        // read full path from crumb
                        dir = dropTarget.data('dir') || '/';
                    }

                    // add target dir
                    data.targetDir = dir;
                } else {
                    // we are dropping somewhere inside the file list, which will
                    // upload the file to the current directory
                    data.targetDir = self.getCurrentDirectory();

                    // cancel uploads to current dir if no permission
                    var isCreatable = (self.getDirectoryPermissions() & OC.PERMISSION_CREATE) !== 0;
                    if (!isCreatable) {
                        self._showPermissionDeniedNotification();
                        return false;
                    }
                }
            });
            fileUploadStart.on('fileuploadadd', function(e, data) {
                OC.Upload.log('filelist handle fileuploadadd', e, data);

                //finish delete if we are uploading a deleted file
                if (self.deleteFiles && self.deleteFiles.indexOf(data.files[0].name)!==-1) {
                    self.finishDelete(null, true); //delete file before continuing
                }

                // add ui visualization to existing folder
                if (data.context && data.context.data('type') === 'dir') {
                    // add to existing folder

                    // update upload counter ui
                    var uploadText = data.context.find('.uploadtext');
                    var currentUploads = parseInt(uploadText.attr('currentUploads'), 10);
                    currentUploads += 1;
                    uploadText.attr('currentUploads', currentUploads);

                    var translatedText = n('files', 'Uploading %n file', 'Uploading %n files', currentUploads);
                    if (currentUploads === 1) {
                        var img = OC.imagePath('core', 'loading.gif');
                        //data.context.find('.thumbnail').css('background-image', 'url(' + img + ')');
                        uploadText.text(translatedText);
                        uploadText.show();
                    } else {
                        uploadText.text(translatedText);
                    }
                }

            });
            /*
             * when file upload done successfully add row to filelist
             * update counter when uploading to sub folder
             */
            fileUploadStart.on('fileuploaddone', function(e, data) {
                OC.Upload.log('filelist handle fileuploaddone', e, data);

                var response;
                if (typeof data.result === 'string') {
                    response = data.result;
                } else {
                    // fetch response from iframe
                    response = data.result[0].body.innerText;
                }
                var result=$.parseJSON(response);

                if (typeof result[0] !== 'undefined' && result[0].status === 'success') {
                    var file = result[0];
                    var size = 0;

                    if (data.context && data.context.data('type') === 'dir') {

                        // update upload counter ui
                        var uploadText = data.context.find('.uploadtext');
                        var currentUploads = parseInt(uploadText.attr('currentUploads'), 10);
                        currentUploads -= 1;
                        uploadText.attr('currentUploads', currentUploads);
                        var translatedText = n('files', 'Uploading %n file', 'Uploading %n files', currentUploads);
                        if (currentUploads === 0) {
                            var img = OC.imagePath('core', 'filetypes/folder');
                            //data.context.find('.thumbnail').css('background-image', 'url(' + img + ')');
                            uploadText.text(translatedText);
                            uploadText.hide();
                        } else {
                            uploadText.text(translatedText);
                        }

                        // update folder size
                        size = parseInt(data.context.data('size'), 10);
                        size += parseInt(file.size, 10);
                        data.context.attr('data-size', size);
                        data.context.find('div.filesize').text(humanFileSize(size));
                    } else {
                        // only append new file if uploaded into the current folder
                        if (file.directory !== self.getCurrentDirectory()) {
                            // Uploading folders actually uploads a list of files
                            // for which the target directory (file.directory) might lie deeper
                            // than the current directory

                            var fileDirectory = file.directory.replace('/','').replace(/\/$/, "");
                            var currentDirectory = self.getCurrentDirectory().replace('/','').replace(/\/$/, "") + '/';

                            if (currentDirectory !== '/') {
                                // abort if fileDirectory does not start with current one
                                if (fileDirectory.indexOf(currentDirectory) !== 0) {
                                    return;
                                }

                                // remove the current directory part
                                fileDirectory = fileDirectory.substr(currentDirectory.length);
                            }

                            // only take the first section of the path
                            fileDirectory = fileDirectory.split('/');

                            var fd;
                            // if the first section exists / is a subdir
                            if (fileDirectory.length) {
                                fileDirectory = fileDirectory[0];

                                // See whether it is already in the list
                                fd = self.findFileEl(fileDirectory);
                                if (fd.length === 0) {
                                    var dir = {
                                        name: fileDirectory,
                                        type: 'dir',
                                        mimetype: 'httpd/unix-directory',
                                        permissions: file.permissions,
                                        size: 0,
                                        id: file.parentId
                                    };
                                    fd = self.add(dir, {insert: true});
                                }

                                // update folder size
                                size = parseInt(fd.attr('data-size'), 10);
                                size += parseInt(file.size, 10);
                                fd.attr('data-size', size);
                                fd.find('div.filesize').text(OC.Util.humanFileSize(size));
                            }

                            return;
                        }

                        // add as stand-alone row to filelist
                        size = t('files', 'Pending');
                        if (data.files[0].size>=0) {
                            size=data.files[0].size;
                        }
                        //should the file exist in the list remove it
                        self.remove(file.name);

                        // create new file context
                        data.context = self.add(file, {animate: true});
                    }
                }
            });
            fileUploadStart.on('fileuploadstop', function(e, data) {
                OC.Upload.log('filelist handle fileuploadstop', e, data);

                //if user pressed cancel hide upload chrome
                if (data.errorThrown === 'abort') {
                    //cleanup uploading to a dir
                    var uploadText = $('li .uploadtext');
                    var img = OC.imagePath('core', 'filetypes/folder');
                    //uploadText.parents('div.filename').find('.thumbnail').css('background-image', 'url(' + img + ')');
                    uploadText.fadeOut();
                    uploadText.attr('currentUploads', 0);
                }
                self.updateStorageStatistics();
            });
            fileUploadStart.on('fileuploadfail', function(e, data) {
                OC.Upload.log('filelist handle fileuploadfail', e, data);

                //if user pressed cancel hide upload chrome
                if (data.errorThrown === 'abort') {
                    //cleanup uploading to a dir
                    var uploadText = $('li .uploadtext');
                    var img = OC.imagePath('core', 'filetypes/folder');
                    //uploadText.parents('div.filename').find('.thumbnail').css('background-image', 'url(' + img + ')');
                    uploadText.fadeOut();
                    uploadText.attr('currentUploads', 0);
                }
                self.updateStorageStatistics();
            });

        },

        /**
         * Scroll to the last file of the given list
         * Highlight the list of files
         * @param files array of filenames,
         * @param {Function} [highlightFunction] optional function
         * to be called after the scrolling is finished
         */
        highlightFiles: function(files, highlightFunction) {
            // Detection of the uploaded element
            var filename = files[files.length - 1];
            var $fileRow = this.findFileEl(filename);

            while(!$fileRow.exists() && this._nextPage(false) !== false) { // Checking element existence
                $fileRow = this.findFileEl(filename);
            }

            if (!$fileRow.exists()) { // Element not present in the file list
                return;
            }

            var currentOffset = this.$container.scrollTop();
            var additionalOffset = this.$el.find("#controls").height()+this.$el.find("#controls").offset().top;

            // Animation
            var _this = this;
            var $scrollContainer = this.$container;
            if ($scrollContainer[0] === window) {
                // need to use "body" to animate scrolling
                // when the scroll container is the window
                $scrollContainer = $('body');
            }
            $scrollContainer.animate({
                // Scrolling to the top of the new element
                scrollTop: currentOffset + $fileRow.offset().top - $fileRow.height() * 2 - additionalOffset
            }, {
                duration: 500,
                complete: function() {
                    // Highlighting function
                    var highlightRow = highlightFunction;

                    if (!highlightRow) {
                        highlightRow = function($fileRow) {
                            $fileRow.addClass("highlightUploaded");
                            setTimeout(function() {
                                $fileRow.removeClass("highlightUploaded");
                            }, 2500);
                        };
                    }

                    // Loop over uploaded files
                    for(var i=0; i<files.length; i++) {
                        var $fileRow = _this.findFileEl(files[i]);

                        if($fileRow.length !== 0) { // Checking element existence
                            highlightRow($fileRow);
                        }
                    }

                }
            });
        }
    };

    /**
     * Sort comparators.
     * @namespace OCA.Files.FileList.Comparators
     * @private
     */
    FileList.Comparators = {
        /**
         * Compares two file infos by name, making directories appear
         * first.
         *
         * @param {OCA.Files.FileInfo} fileInfo1 file info
         * @param {OCA.Files.FileInfo} fileInfo2 file info
         * @return {int} -1 if the first file must appear before the second one,
         * 0 if they are identify, 1 otherwise.
         */
        name: function(fileInfo1, fileInfo2) {
            if (fileInfo1.type === 'dir' && fileInfo2.type !== 'dir') {
                return -1;
            }
            if (fileInfo1.type !== 'dir' && fileInfo2.type === 'dir') {
                return 1;
            }
            return OC.Util.naturalSortCompare(fileInfo1.name, fileInfo2.name);
        },
        /**
         * Compares two file infos by size.
         *
         * @param {OCA.Files.FileInfo} fileInfo1 file info
         * @param {OCA.Files.FileInfo} fileInfo2 file info
         * @return {int} -1 if the first file must appear before the second one,
         * 0 if they are identify, 1 otherwise.
         */
        size: function(fileInfo1, fileInfo2) {
            return fileInfo1.size - fileInfo2.size;
        },
        /**
         * Compares two file infos by timestamp.
         *
         * @param {OCA.Files.FileInfo} fileInfo1 file info
         * @param {OCA.Files.FileInfo} fileInfo2 file info
         * @return {int} -1 if the first file must appear before the second one,
         * 0 if they are identify, 1 otherwise.
         */
        mtime: function(fileInfo1, fileInfo2) {
            return fileInfo1.mtime - fileInfo2.mtime;
        }
    };

    /**
     * File info attributes.
     *
     * @todo make this a real class in the future
     * @typedef {Object} OCA.Files.FileInfo
     *
     * @property {int} id file id
     * @property {String} name file name
     * @property {String} [path] file path, defaults to the list's current path
     * @property {String} mimetype mime type
     * @property {String} type "file" for files or "dir" for directories
     * @property {int} permissions file permissions
     * @property {int} mtime modification time in milliseconds
     * @property {boolean} [isShareMountPoint] whether the file is a share mount
     * point
     * @property {boolean} [isPreviewAvailable] whether a preview is available
     * for the given file type
     * @property {String} [icon] path to the mime type icon
     * @property {String} etag etag of the file
     */

    OCA.Files.FileList = FileList;
})();

function removeFileMobileAnimation() {
    var elStartPadding = $('.upload-view .upload-item').css('padding-left');
    $('body').on('click', '.mobileRemove', function (event) {
        var el = $(this).parents('.upload-item');
        var subEl = el.find('.removeFile');
        var subElWidth = subEl.width();

        if (!$(el).is(':animated')) {
            if (el.css('padding-left') == elStartPadding) {
                $(el).animate({'padding-left': '+=' + subElWidth}, 600);
                $(el).find('.removeFile').fadeIn();
            } else {
                $(el).animate({'padding-left': '-=' + subElWidth}, 600);
                $(el).find('.removeFile').fadeOut();
            }
        }
        event.stopPropagation();
    });
    $('body').click(function () {
        $('.upload-view .upload-item').animate({'padding-left': elStartPadding}, 600);
        $('.upload-view .upload-item').find('.removeFile').fadeOut();
    });
}
$(document).ready(function() {
    if($(window).width() < 768){
        gridView()
    }
    // FIXME: unused ?
    OCA.Files.FileList.useUndo = (window.onbeforeunload)?true:false;
    $(window).bind('beforeunload', function () {
        if (OCA.Files.FileList.lastAction) {
            OCA.Files.FileList.lastAction();
        }
    });
    $(window).unload(function () {
        $(window).trigger('beforeunload');
    });
    $('#controls .actions .control-buttons .control-view-block').click(function(){
        if($('.fullinfo').is(':visible')){
            return false;
        }
        blocksView();
        OCA.Files.FileList.prototype._folders(OCA.Files.FileList.prototype.$fileList);
    });
    $('#controls .actions .control-buttons .control-view-list').click(function(){
        listView();
        OCA.Files.FileList.prototype._folders(OCA.Files.FileList.prototype.$fileList);
    });
    $('#controls .actions .control-buttons .control-view-grid').click(function(){
        if($('.fullinfo').is(':visible')){
            return false;
        }
        gridView();
        OCA.Files.FileList.prototype._folders(OCA.Files.FileList.prototype.$fileList);
    });
    $(function cookieView() {
        var view = (typeof $.cookie === 'function' && $.cookie('display'))? $.cookie('display') : 'list';
        if(view === 'list') {
            listView();
        } else if(view === 'blocks'){
            blocksView();
        } else if(view === 'grid') {
            gridView();
        }
    });
    $('body').on('click', '.upload-file, .main-context-upload',function(){
        chooseFiles();
        //if ($(window).width() < 321){$('#fileList').css('display','none');}
    });

    $('body').on('click', '.upload-folder, .main-context-upload-folder',function(){
        chooseFolder();
    });
    $('body').on('click', '.block-switcher', function(){
        $(this).toggleClass('toggled');
        $(this).parent().find('.blockContainer').slideToggle();
    });
});
//that all coz we have 2 days for all this