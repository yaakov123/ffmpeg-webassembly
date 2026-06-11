IMAGE := ffweb-builder
DOCKER_RUN := docker run --rm -v $(CURDIR):/src -w /src $(IMAGE)

.PHONY: image fetch libs cores core-lgpl core-gpl clean

image:
	docker build -t $(IMAGE) build/

fetch:
	$(DOCKER_RUN) bash build/fetch.sh

libs:
	$(DOCKER_RUN) bash build/build-libs.sh

cores: core-lgpl core-gpl

core-lgpl:
	$(DOCKER_RUN) bash build/build-ffmpeg.sh lgpl
	$(DOCKER_RUN) bash build/link.sh lgpl

core-gpl:
	$(DOCKER_RUN) bash build/build-ffmpeg.sh gpl
	$(DOCKER_RUN) bash build/link.sh gpl

clean:
	rm -rf build/out packages/core/dist packages/core-gpl/dist
